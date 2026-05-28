/* ========================================
   Entra ID Tenant Lookup
   Pure-browser lookup via Microsoft's public,
   unauthenticated discovery endpoints.

   - GUID input:   OpenID Connect discovery
   - Domain input: OpenID Connect discovery + GetUserRealm
                   (returns Organization / FederationBrandName)
   - Domain enumeration via Autodiscover SOAP (backend)
   - Desktop SSO detection via GetCredentialType
   - DNS-based M365 service detection via Google DNS API
   ======================================== */

(function () {
    'use strict';

    const GUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

    // Idefix-hosted Azure Function endpoints
    const API_BASE = 'https://func-idefix-tenantlookup.azurewebsites.net/api';
    const LOOKUP_API  = `${API_BASE}/lookup`;
    const DOMAINS_API = `${API_BASE}/domains`;

    // Known public Microsoft cloud instances
    const CLOUDS = [
        { host: 'login.microsoftonline.com',        type: 'Commercial / Worldwide' },
        { host: 'login.microsoftonline.us',         type: 'US Government (GCC High / DoD)' },
        { host: 'login.partner.microsoftonline.cn', type: 'China (operated by 21Vianet)' }
    ];

    const REGION_SCOPES = {
        'NA':    'North America',
        'EU':    'Europe',
        'AS':    'Asia',
        'OC':    'Oceania (Australia / New Zealand)',
        'AF':    'Africa',
        'SA':    'South America',
        'ME':    'Middle East',
        'WW':    'Worldwide',
        'USG':   'US Government',
        'USGov': 'US Government',
        'USL4':  'US Government (IL4)',
        'USL5':  'US Government (IL5 / DoD)'
    };

    const NAMESPACE_LABELS = {
        'Managed':   'Managed (cloud-only / hybrid sync)',
        'Federated': 'Federated (external IdP / ADFS)',
        'Unknown':   'Unknown / not found',
        'Unmanaged': 'Unmanaged (viral / self-service)'
    };

    // DNS service detection labels
    const SERVICE_ICONS = {
        exchange:  { icon: 'fa-envelope',          label: 'Exchange Online',   color: '#0078d4' },
        spf:       { icon: 'fa-shield-halved',     label: 'SPF',               color: '#107c10' },
        dmarc:     { icon: 'fa-user-shield',       label: 'DMARC',             color: '#5c2d91' },
        dkim:      { icon: 'fa-key',               label: 'DKIM',              color: '#008272' },
        teams:     { icon: 'fa-video',             label: 'Teams / SfB',       color: '#6264a7' },
        intune:    { icon: 'fa-mobile-screen',     label: 'Intune / MDM',      color: '#0078d4' },
        aadConnect:{ icon: 'fa-arrows-rotate',     label: 'Entra Connect',     color: '#ff8c00' }
    };

    // DOM
    const $ = (id) => document.getElementById(id);
    const els = {
        input:       $('tenantInput'),
        btn:         $('lookupBtn'),
        chips:       document.querySelectorAll('.tl-chip'),
        section:     $('resultsSection'),
        status:      $('statusBox'),
        card:        $('resultsCard'),
        cloudBadge:  $('cloudBadgeText'),
        copyBtn:     $('copyJsonBtn'),
        raw:         $('rawJson'),
        f: {
            orgNameWrap:    $('fOrgNameWrap'),
            orgName:        $('fOrgName'),
            domainWrap:     $('fDomainWrap'),
            domain:         $('fDomain'),
            namespaceWrap:  $('fNamespaceWrap'),
            namespace:      $('fNamespace'),
            tenantId:       $('fTenantId'),
            cloudInstance:  $('fCloudInstance'),
            cloudType:      $('fCloudType'),
            regionScope:    $('fRegionScope'),
            regionSubScope: $('fRegionSubScope'),
            region:         $('fRegion'),
            ssoWrap:        $('fSsoWrap'),
            sso:            $('fSso'),
            fedDetailsWrap: $('fFedDetailsWrap'),
            fedAuthUrl:     $('fFedAuthUrl'),
            fedProtocol:    $('fFedProtocol'),
            issuer:         $('fIssuer'),
            authEndpoint:   $('fAuthEndpoint'),
            tokenEndpoint:  $('fTokenEndpoint')
        },
        domainsSection:  $('domainsSection'),
        domainsList:     $('domainsList'),
        domainsCount:    $('domainsCount'),
        domainsLoading:  $('domainsLoading'),
        domainsError:    $('domainsError'),
        dnsSection:      $('dnsSection'),
        dnsResults:      $('dnsResults'),
        dnsLoading:      $('dnsLoading')
    };

    // ---- Events ----
    els.btn.addEventListener('click', runLookup);
    els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runLookup(); });
    els.chips.forEach((chip) => {
        chip.addEventListener('click', () => {
            els.input.value = chip.dataset.example;
            runLookup();
        });
    });
    els.copyBtn.addEventListener('click', copyJson);

    // ---- Main lookup ----
    async function runLookup() {
        const raw = (els.input.value || '').trim().toLowerCase();
        showSection();

        if (!raw) return showError('Please enter a tenant ID (GUID) or a domain name.');

        const isGuid   = GUID_RE.test(raw);
        const isDomain = !isGuid && DOMAIN_RE.test(raw);

        if (!isGuid && !isDomain) {
            return showError('Input must be either a GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) or a valid domain (e.g. contoso.com).');
        }

        setLoading(true);
        hideStatus();
        els.card.hidden = true;
        resetExtendedSections();

        try {
            const result = isGuid
                ? await lookupByIdentifier(raw, null)
                : await lookupByIdentifier(raw, raw);
            renderResult(result);
            // Fire off extended lookups asynchronously after the main card renders
            loadExtendedInfo(result);
        } catch (err) {
            console.error(err);
            showError(err && err.message ? err.message : 'Lookup failed.');
        } finally {
            setLoading(false);
        }
    }

    // identifier: GUID or domain (used in OIDC URL)
    // domain:     present only when input was a domain (drives GetUserRealm)
    async function lookupByIdentifier(identifier, domain) {
        const { config, cloud } = await discoverOidc(identifier);
        let realm = null;
        let graphInfo = null;
        let credType = null;

        // UserRealm + GetCredentialType run in parallel for domain lookups
        if (domain) {
            const [realmRes, credRes] = await Promise.allSettled([
                fetchUserRealm(domain),
                fetchCredentialType(domain)
            ]);
            if (realmRes.status === 'fulfilled') realm = realmRes.value;
            else console.warn('GetUserRealm failed:', realmRes.reason);
            if (credRes.status === 'fulfilled') credType = credRes.value;
            else console.warn('GetCredentialType failed:', credRes.reason);
        }

        // For GUID lookups, ask the Idefix backend for the display name.
        const tenantIdForGraph = GUID_RE.test(identifier)
            ? identifier
            : extractTenantIdFromUrl(config.issuer);
        if (tenantIdForGraph) {
            try { graphInfo = await fetchGraphInfo(tenantIdForGraph); }
            catch (e) { console.warn('Graph proxy lookup failed:', e); }
        }

        // For GUID lookups, try SSO detection using the default domain from Graph
        if (!domain && graphInfo && graphInfo.defaultDomainName) {
            try { credType = await fetchCredentialType(graphInfo.defaultDomainName); }
            catch (e) { console.warn('GetCredentialType failed:', e); }
        }

        return { identifier, domain, config, cloud, realm, graphInfo, credType };
    }

    async function fetchGraphInfo(tenantId) {
        const resp = await fetch(`${LOOKUP_API}/${encodeURIComponent(tenantId)}`, {
            method: 'GET',
            mode: 'cors'
        });
        if (!resp.ok) return null;
        return resp.json();
    }

    // Try each cloud's OpenID configuration endpoint until one resolves
    async function discoverOidc(identifier) {
        let lastErr = null;
        for (const cloud of CLOUDS) {
            const url = `https://${cloud.host}/${encodeURIComponent(identifier)}/v2.0/.well-known/openid-configuration`;
            try {
                const resp = await fetch(url, { method: 'GET', mode: 'cors' });
                if (resp.ok) {
                    const config = await resp.json();
                    return { config, cloud };
                }
                lastErr = new Error(`HTTP ${resp.status} from ${cloud.host}`);
            } catch (e) {
                lastErr = e;
            }
        }
        throw new Error(
            'Tenant not found in any known Microsoft cloud (Commercial, US Gov, China). ' +
            'Verify the GUID or domain is associated with a real Entra ID tenant.'
        );
    }

    async function fetchUserRealm(domain) {
        const probe = `probe@${domain}`;
        // v2.1 returns DomainName, FederationBrandName, NameSpaceType, cloud_instance_name
        const url = `https://login.microsoftonline.com/common/userrealm/${encodeURIComponent(probe)}?api-version=2.1`;
        const resp = await fetch(url, { method: 'GET', mode: 'cors' });
        if (!resp.ok) throw new Error(`UserRealm HTTP ${resp.status}`);
        return resp.json();
    }

    // GetCredentialType — detects Desktop SSO (Seamless SSO). Public endpoint.
    // IMPORTANT: We intentionally ignore IfExistsResult (user enumeration) for security.
    async function fetchCredentialType(domain) {
        const url = 'https://login.microsoftonline.com/common/GetCredentialType';
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: `probe@${domain}`,
                isOtherIdpSupported: true,
                checkPhones: false,
                isRemoteNGCSupported: true,
                isCookieBannerShown: false,
                isFidoSupported: true,
                originalRequest: '',
                country: '',
                forceotclogin: false,
                isExternalFederationDisallowed: false,
                isRemoteConnectSupported: false,
                federationFlags: 0,
                isSignup: false,
                isAccessPassSupported: true
            })
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        // Only extract SSO-relevant info — strip user-existence data
        return {
            desktopSsoEnabled: !!(data.EstsProperties && data.EstsProperties.DesktopSsoEnabled),
            isSignupDisallowed: data.IsSignupDisallowed ?? null,
            hasPassword: data.Credentials && data.Credentials.HasPassword != null ? data.Credentials.HasPassword : null,
            prefCredential: data.Credentials && data.Credentials.PrefCredential != null ? data.Credentials.PrefCredential : null
        };
    }

    // Fetch with timeout helper
    function fetchWithTimeout(url, opts, ms) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        return fetch(url, { ...opts, signal: controller.signal })
            .finally(() => clearTimeout(timer));
    }

    // Fetch all verified domains for a tenant via Autodiscover (backend proxy)
    async function fetchTenantDomains(domain) {
        const resp = await fetchWithTimeout(
            `${DOMAINS_API}/${encodeURIComponent(domain)}`,
            { method: 'GET', mode: 'cors' },
            15000
        );
        if (!resp.ok) return null;
        return resp.json();
    }

    // ---- DNS Service Detection via Google DNS-over-HTTPS ----
    async function dnsLookup(name, type) {
        try {
            const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
            const resp = await fetch(url);
            if (!resp.ok) return null;
            const data = await resp.json();
            return data.Answer || null;
        } catch { return null; }
    }

    // Returns an object where each key is true (found), false (missing), or undefined (not applicable).
    // Email security checks (spf, dmarc, dkim) are always checked for all domains.
    // Service checks (exchange, teams, intune, aadConnect) are true when found, omitted when not.
    async function detectServicesForDomain(domain) {
        const services = {};

        // Run all DNS checks in parallel
        const [mx, txt, dmarc, dkim1, dkim2, sip, entReg, msoid] = await Promise.allSettled([
            dnsLookup(domain, 'MX'),
            dnsLookup(domain, 'TXT'),
            dnsLookup(`_dmarc.${domain}`, 'TXT'),
            dnsLookup(`selector1._domainkey.${domain}`, 'CNAME'),
            dnsLookup(`selector2._domainkey.${domain}`, 'CNAME'),
            dnsLookup(`_sipfederationtls._tcp.${domain}`, 'SRV'),
            dnsLookup(`enterpriseregistration.${domain}`, 'CNAME'),
            dnsLookup(`msoid.${domain}`, 'CNAME')
        ]);

        // Exchange Online (MX points to *.mail.protection.outlook.com)
        const mxRecords = mx.status === 'fulfilled' ? mx.value : null;
        const hasExchange = mxRecords && mxRecords.some(r => r.data && r.data.toLowerCase().includes('mail.protection.outlook.com'));
        if (hasExchange) services.exchange = true;

        // SPF — always check (relevant for any domain that might send email)
        const txtRecords = txt.status === 'fulfilled' ? txt.value : null;
        const hasSpf = txtRecords && txtRecords.some(r => r.data && r.data.toLowerCase().includes('spf.protection.outlook.com'));
        services.spf = !!hasSpf;

        // DMARC — always check
        const dmarcRecords = dmarc.status === 'fulfilled' ? dmarc.value : null;
        const hasDmarc = dmarcRecords && dmarcRecords.some(r => r.data && r.data.toLowerCase().includes('v=dmarc'));
        services.dmarc = !!hasDmarc;

        // DKIM — always check (selector1 or selector2)
        const dkim1Records = dkim1.status === 'fulfilled' ? dkim1.value : null;
        const dkim2Records = dkim2.status === 'fulfilled' ? dkim2.value : null;
        const hasDkim = (dkim1Records && dkim1Records.length > 0) || (dkim2Records && dkim2Records.length > 0);
        services.dkim = !!hasDkim;

        // Teams / Skype for Business (SRV _sipfederationtls._tcp)
        const sipRecords = sip.status === 'fulfilled' ? sip.value : null;
        if (sipRecords && sipRecords.some(r => r.data && r.data.toLowerCase().includes('sipfed.online.lync.com'))) {
            services.teams = true;
        }

        // Intune / MDM (enterpriseregistration → enterpriseregistration.windows.net)
        const entRegRecords = entReg.status === 'fulfilled' ? entReg.value : null;
        if (entRegRecords && entRegRecords.some(r => r.data && r.data.toLowerCase().includes('enterpriseregistration.windows.net'))) {
            services.intune = true;
        }

        // Entra Connect (msoid CNAME → clientconfig.microsoftonline-p.net)
        const msoidRecords = msoid.status === 'fulfilled' ? msoid.value : null;
        if (msoidRecords && msoidRecords.length > 0) {
            services.aadConnect = true;
        }

        return services;
    }

    // ---- Rendering ----
    function renderResult({ domain, config, cloud, realm, graphInfo, credType }) {
        const issuerTid = extractTenantIdFromUrl(config.issuer) || '';

        // Organization name: prefer Graph (works for GUIDs), fall back to UserRealm (domain mode)
        const orgName =
            (graphInfo && graphInfo.displayName) ||
            (realm && realm.FederationBrandName) ||
            null;
        toggleField(els.f.orgNameWrap, !!orgName);
        if (orgName) els.f.orgName.textContent = orgName;

        // Domain: prefer Graph defaultDomainName, then realm DomainName, then queried domain
        const queriedDomain =
            (graphInfo && graphInfo.defaultDomainName) ||
            (realm && realm.DomainName) ||
            domain ||
            null;
        toggleField(els.f.domainWrap, !!queriedDomain);
        if (queriedDomain) els.f.domain.textContent = queriedDomain;

        // Namespace type (only from UserRealm / domain mode)
        const ns = realm && realm.NameSpaceType ? realm.NameSpaceType : null;
        toggleField(els.f.namespaceWrap, !!ns);
        if (ns) els.f.namespace.textContent = NAMESPACE_LABELS[ns] || ns;

        // Desktop SSO
        if (credType) {
            toggleField(els.f.ssoWrap, true);
            els.f.sso.textContent = credType.desktopSsoEnabled ? 'Enabled' : 'Disabled';
            els.f.sso.className = 'tl-field-value tl-sso-badge ' + (credType.desktopSsoEnabled ? 'tl-sso-on' : 'tl-sso-off');
        } else {
            toggleField(els.f.ssoWrap, false);
        }

        // Federation details (from UserRealm, only when Federated)
        const isFederated = ns === 'Federated';
        const authUrl = realm && realm.AuthURL ? realm.AuthURL : null;
        const fedProtocol = realm && realm.FederationProtocol ? realm.FederationProtocol : null;
        toggleField(els.f.fedDetailsWrap, isFederated && (authUrl || fedProtocol));
        if (authUrl) els.f.fedAuthUrl.textContent = authUrl;
        if (fedProtocol) els.f.fedProtocol.textContent = fedProtocol;

        // Core OIDC fields
        els.f.tenantId.textContent      = (graphInfo && graphInfo.tenantId) || issuerTid || '—';
        els.f.cloudInstance.textContent = cloud.host;
        els.f.cloudType.textContent     = cloud.type;

        const scope = config.tenant_region_scope || '—';
        const sub   = config.tenant_region_sub_scope || '—';
        const region= config.tenant_region || '—';
        els.f.regionScope.textContent    = scope === '—' ? '—' : `${scope} — ${REGION_SCOPES[scope] || 'Unknown'}`;
        els.f.regionSubScope.textContent = sub;
        els.f.region.textContent         = region;
        els.f.issuer.textContent         = config.issuer || '—';
        els.f.authEndpoint.textContent   = config.authorization_endpoint || '—';
        els.f.tokenEndpoint.textContent  = config.token_endpoint || '—';

        els.cloudBadge.textContent = cloud.type;

        // Combined raw payload
        els.raw.textContent = JSON.stringify({
            openid_configuration: config,
            user_realm: realm || null,
            graph_info: graphInfo || null,
            credential_type: credType || null
        }, null, 2);

        els.card.hidden = false;
        els.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ---- Extended info (domains + DNS) — loaded after main card renders ----
    async function loadExtendedInfo(result) {
        const { identifier, domain, graphInfo, realm, config } = result;
        const tenantId = (graphInfo && graphInfo.tenantId) || extractTenantIdFromUrl(config.issuer) || '';

        // Collect known domains from all sources we already have
        const knownDomains = new Set();

        // From Graph API
        if (graphInfo && graphInfo.defaultDomainName) knownDomains.add(graphInfo.defaultDomainName.toLowerCase());

        // From UserRealm
        if (realm && realm.DomainName) knownDomains.add(realm.DomainName.toLowerCase());

        // The queried domain itself
        if (domain) knownDomains.add(domain.toLowerCase());

        // Extract tenant name from defaultDomainName to probe .onmicrosoft.com patterns
        const defaultDomain = (graphInfo && graphInfo.defaultDomainName) || '';
        const onmicroMatch = defaultDomain.match(/^(.+)\.onmicrosoft\.com$/i);
        if (onmicroMatch) {
            const tenantName = onmicroMatch[1].toLowerCase();
            knownDomains.add(`${tenantName}.onmicrosoft.com`);
            knownDomains.add(`${tenantName}.mail.onmicrosoft.com`);
        }

        // Show domains section with loading state
        els.domainsSection.hidden = false;
        els.domainsLoading.hidden = false;
        els.domainsError.hidden = true;
        els.domainsList.innerHTML = '';

        // Try Autodiscover for each known domain — each may return different additional domains
        const domainsToProbe = [...knownDomains].filter(d => !d.endsWith('.onmicrosoft.com'));
        const autodiscoverPromises = domainsToProbe.map(d =>
            fetchTenantDomains(d).catch(() => null)
        );
        const autodiscoverResults = await Promise.allSettled(autodiscoverPromises);
        for (const r of autodiscoverResults) {
            if (r.status === 'fulfilled' && r.value && r.value.domains) {
                r.value.domains.forEach(d => knownDomains.add(d.toLowerCase()));
            }
        }

        // If defaultDomainName is a custom domain, try to discover the .onmicrosoft.com name
        // by probing OIDC for each discovered domain to find a *.onmicrosoft.com one
        if (!onmicroMatch && tenantId) {
            // Try a common pattern: lowercase displayName with spaces/special chars removed
            const displayName = (graphInfo && graphInfo.displayName) || '';
            const guessName = displayName.replace(/[^a-z0-9]/gi, '').toLowerCase();
            if (guessName.length >= 3) {
                try {
                    const probeUrl = `https://login.microsoftonline.com/${encodeURIComponent(guessName + '.onmicrosoft.com')}/v2.0/.well-known/openid-configuration`;
                    const probeResp = await fetch(probeUrl, { method: 'GET', mode: 'cors' });
                    if (probeResp.ok) {
                        const probeConfig = await probeResp.json();
                        const probeTid = extractTenantIdFromUrl(probeConfig.issuer);
                        if (probeTid && probeTid.toLowerCase() === tenantId.toLowerCase()) {
                            knownDomains.add(`${guessName}.onmicrosoft.com`);
                            knownDomains.add(`${guessName}.mail.onmicrosoft.com`);
                        }
                    }
                } catch { /* probe failed, that's fine */ }
            }
        }

        els.domainsLoading.hidden = true;

        const allDomains = [...knownDomains].sort((a, b) => {
            // Sort: custom domains first, then .onmicrosoft.com variants
            const aMs = a.endsWith('.onmicrosoft.com') ? 1 : 0;
            const bMs = b.endsWith('.onmicrosoft.com') ? 1 : 0;
            if (aMs !== bMs) return aMs - bMs;
            return a.localeCompare(b);
        });

        if (allDomains.length === 0) {
            els.domainsError.hidden = false;
            els.domainsError.textContent = 'No domains found for this tenant.';
            return;
        }

        els.domainsCount.textContent = allDomains.length;
        renderDomainsList(allDomains);
        updateRawJson({ known_domains: allDomains });

        // Start DNS detection for custom domains
        loadDnsDetection(allDomains);
    }

    function renderDomainsList(domains) {
        els.domainsList.innerHTML = '';
        domains.forEach((d) => {
            const li = document.createElement('li');
            li.className = 'tl-domain-item';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'tl-domain-name';
            nameSpan.textContent = d;
            li.appendChild(nameSpan);

            // Badges container for DNS results (filled later)
            const badges = document.createElement('div');
            badges.className = 'tl-domain-badges';
            badges.dataset.domain = d;

            // Show a placeholder while DNS checks run
            if (!d.endsWith('.onmicrosoft.com')) {
                const placeholder = document.createElement('span');
                placeholder.className = 'tl-badge-placeholder';
                placeholder.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking DNS…';
                badges.appendChild(placeholder);
            }

            li.appendChild(badges);
            els.domainsList.appendChild(li);
        });
    }

    async function loadDnsDetection(domains) {
        els.dnsSection.hidden = false;
        els.dnsLoading.hidden = false;
        els.dnsResults.innerHTML = '';

        // Filter to non-.onmicrosoft.com domains for DNS checks (onmicrosoft are MS-managed)
        const checkable = domains.filter(d => !d.endsWith('.onmicrosoft.com'));
        const MAX_DNS_CHECKS = 15; // rate-limit DNS queries for large tenants
        const toCheck = checkable.slice(0, MAX_DNS_CHECKS);

        const allServices = {};
        for (const d of toCheck) {
            try {
                const svc = await detectServicesForDomain(d);
                allServices[d] = svc;
                // Update inline badges on each domain row
                renderDomainBadges(d, svc);
            } catch (e) {
                console.warn(`DNS check failed for ${d}:`, e);
            }
        }

        els.dnsLoading.hidden = true;
        renderDnsSummary(allServices, checkable.length > MAX_DNS_CHECKS ? checkable.length - MAX_DNS_CHECKS : 0);

        // Update raw JSON
        updateRawJson({ dns_services: allServices });
    }

    function renderDomainBadges(domain, services) {
        const container = document.querySelector(`.tl-domain-badges[data-domain="${CSS.escape(domain)}"]`);
        if (!container) return;
        container.innerHTML = '';

        // Service badges (only shown when detected)
        const svcKeys = ['exchange', 'teams', 'intune', 'aadConnect'];
        const svcWrap = document.createElement('div');
        svcWrap.className = 'tl-badge-row tl-badge-services';
        for (const key of svcKeys) {
            if (services[key] !== true || !SERVICE_ICONS[key]) continue;
            const info = SERVICE_ICONS[key];
            const badge = document.createElement('span');
            badge.className = 'tl-svc-tag';
            badge.innerHTML = `<i class="fas ${info.icon}" style="color:${info.color}"></i> ${escapeHtml(info.label)}`;
            svcWrap.appendChild(badge);
        }
        if (svcWrap.children.length > 0) container.appendChild(svcWrap);

        // Email security badges (always shown: pass or fail)
        const emailKeys = ['spf', 'dmarc', 'dkim'];
        const hasAnyEmail = emailKeys.some(k => services[k] !== undefined);
        if (hasAnyEmail) {
            const emailWrap = document.createElement('div');
            emailWrap.className = 'tl-badge-row tl-badge-email';
            for (const key of emailKeys) {
                if (services[key] === undefined) continue;
                const info = SERVICE_ICONS[key];
                const badge = document.createElement('span');
                if (services[key]) {
                    badge.className = 'tl-email-tag tl-email-pass';
                    badge.innerHTML = `<i class="fas fa-circle-check"></i> ${escapeHtml(info.label)}`;
                } else {
                    badge.className = 'tl-email-tag tl-email-fail';
                    badge.innerHTML = `<i class="fas fa-circle-xmark"></i> ${escapeHtml(info.label)}`;
                }
                emailWrap.appendChild(badge);
            }
            container.appendChild(emailWrap);
        }
    }

    function renderDnsSummary(allServices, remaining) {
        // Aggregate: found (true somewhere), missing (false somewhere and never true)
        const found = {};
        const missing = {};
        const missingDomains = {}; // key → [domains where it's missing]

        for (const [domain, svc] of Object.entries(allServices)) {
            for (const [key, value] of Object.entries(svc)) {
                if (value === true) {
                    found[key] = true;
                } else if (value === false) {
                    if (!missingDomains[key]) missingDomains[key] = [];
                    missingDomains[key].push(domain);
                }
            }
        }
        // Only flag as "missing" if it's false on at least one domain
        for (const key of Object.keys(missingDomains)) {
            missing[key] = true;
        }

        els.dnsResults.innerHTML = '';

        const allKeys = new Set([...Object.keys(found), ...Object.keys(missing)]);
        if (allKeys.size === 0) {
            els.dnsResults.innerHTML = '<span class="tl-dns-none">No Microsoft 365 DNS records detected.</span>';
            return;
        }

        // Section 1: Detected M365 Services
        const svcKeys = ['exchange', 'teams', 'intune', 'aadConnect'];
        const foundSvcKeys = svcKeys.filter(k => found[k]);
        if (foundSvcKeys.length > 0) {
            const svcBox = document.createElement('div');
            svcBox.className = 'tl-dns-category';
            svcBox.innerHTML = '<h5><i class="fas fa-cloud"></i> Microsoft 365 Services</h5>';
            const pills = document.createElement('div');
            pills.className = 'tl-dns-pills';
            for (const key of foundSvcKeys) {
                const info = SERVICE_ICONS[key];
                if (!info) continue;
                const pill = document.createElement('span');
                pill.className = 'tl-dns-pill tl-dns-ok';
                pill.innerHTML = `<i class="fas ${info.icon}" style="color:${info.color}"></i> ${escapeHtml(info.label)}`;
                pills.appendChild(pill);
            }
            svcBox.appendChild(pills);
            els.dnsResults.appendChild(svcBox);
        }

        // Section 2: Email Security Health
        const SECURITY_CHECKS = ['spf', 'dmarc', 'dkim'];
        const hasAnyEmailCheck = SECURITY_CHECKS.some(k => found[k] || missing[k]);
        if (hasAnyEmailCheck) {
            const emailBox = document.createElement('div');
            emailBox.className = 'tl-dns-category';
            emailBox.innerHTML = '<h5><i class="fas fa-shield-halved"></i> Email Security Health</h5>';

            const allPassed = SECURITY_CHECKS.every(k => found[k] && !missing[k]);

            if (allPassed) {
                const overall = document.createElement('div');
                overall.className = 'tl-email-health tl-email-health-good';
                overall.innerHTML = '<i class="fas fa-circle-check"></i> All email security records properly configured across all domains';
                emailBox.appendChild(overall);
            }

            const pills = document.createElement('div');
            pills.className = 'tl-dns-pills';
            for (const key of SECURITY_CHECKS) {
                const info = SERVICE_ICONS[key];
                if (!info) continue;
                const pill = document.createElement('span');
                if (found[key] && !missing[key]) {
                    pill.className = 'tl-dns-pill tl-dns-ok';
                    pill.innerHTML = `<i class="fas fa-circle-check"></i> ${escapeHtml(info.label)}`;
                } else if (missing[key]) {
                    const domains = missingDomains[key] || [];
                    pill.className = 'tl-dns-pill tl-dns-warn';
                    pill.title = 'Missing on: ' + domains.join(', ');
                    pill.innerHTML = `<i class="fas fa-circle-xmark"></i> ${escapeHtml(info.label)} missing` +
                        (domains.length === 1 ? ` on ${escapeHtml(domains[0])}` : ` on ${domains.length} domain${domains.length > 1 ? 's' : ''}`);
                }
                pills.appendChild(pill);
            }
            emailBox.appendChild(pills);
            els.dnsResults.appendChild(emailBox);
        }

        if (remaining > 0) {
            const note = document.createElement('span');
            note.className = 'tl-dns-note';
            note.textContent = `(${remaining} more domain${remaining > 1 ? 's' : ''} not checked)`;
            els.dnsResults.appendChild(note);
        }
    }

    function resetExtendedSections() {
        els.domainsSection.hidden = true;
        els.domainsList.innerHTML = '';
        els.domainsCount.textContent = '0';
        els.domainsLoading.hidden = true;
        els.domainsError.hidden = true;
        els.dnsSection.hidden = true;
        els.dnsResults.innerHTML = '';
        els.dnsLoading.hidden = true;
    }

    function updateRawJson(extra) {
        try {
            const existing = JSON.parse(els.raw.textContent);
            Object.assign(existing, extra);
            els.raw.textContent = JSON.stringify(existing, null, 2);
        } catch { /* ignore */ }
    }

    function extractTenantIdFromUrl(url) {
        if (!url) return null;
        const m = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        return m ? m[1] : null;
    }

    function toggleField(wrapEl, show) {
        if (!wrapEl) return;
        wrapEl.hidden = !show;
    }

    // ---- UI helpers ----
    function showSection() { els.section.hidden = false; }

    function showError(message) {
        els.section.hidden = false;
        els.card.hidden = true;
        els.status.hidden = false;
        els.status.className = 'tl-status is-error';
        els.status.innerHTML = `<i class="fas fa-triangle-exclamation"></i><span>${escapeHtml(message)}</span>`;
    }

    function hideStatus() {
        els.status.hidden = true;
        els.status.textContent = '';
    }

    function setLoading(isLoading) {
        els.btn.disabled = isLoading;
        els.btn.innerHTML = isLoading
            ? '<i class="fas fa-spinner"></i><span>Looking up…</span>'
            : '<i class="fas fa-magnifying-glass"></i><span>Look up</span>';
    }

    async function copyJson() {
        try {
            await navigator.clipboard.writeText(els.raw.textContent);
            const original = els.copyBtn.innerHTML;
            els.copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied';
            setTimeout(() => { els.copyBtn.innerHTML = original; }, 1500);
        } catch { /* ignore */ }
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
})();

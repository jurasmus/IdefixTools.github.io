/* ========================================
   Entra ID Tenant Lookup
   Pure-browser lookup via Microsoft's public,
   unauthenticated discovery endpoints.

   - GUID input:   OpenID Connect discovery
   - Domain input: OpenID Connect discovery + GetUserRealm
                   (returns Organization / FederationBrandName)
   ======================================== */

(function () {
    'use strict';

    const GUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

    // Idefix-hosted Azure Function that proxies Microsoft Graph's
    // findTenantInformationByTenantId. Returns display name + default domain
    // for a GUID. Returns null silently if the call fails.
    const LOOKUP_API = 'https://func-idefix-tenantlookup.azurewebsites.net/api/lookup';

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
            issuer:         $('fIssuer'),
            authEndpoint:   $('fAuthEndpoint'),
            tokenEndpoint:  $('fTokenEndpoint')
        }
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

        try {
            const result = isGuid
                ? await lookupByIdentifier(raw, null)
                : await lookupByIdentifier(raw, raw);
            renderResult(result);
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

        if (domain) {
            try { realm = await fetchUserRealm(domain); }
            catch (e) { console.warn('GetUserRealm failed:', e); }
        }

        // For GUID lookups, ask the Idefix backend for the display name.
        const tenantIdForGraph = GUID_RE.test(identifier)
            ? identifier
            : extractTenantIdFromUrl(config.issuer);
        if (tenantIdForGraph) {
            try { graphInfo = await fetchGraphInfo(tenantIdForGraph); }
            catch (e) { console.warn('Graph proxy lookup failed:', e); }
        }

        return { identifier, domain, config, cloud, realm, graphInfo };
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

    // ---- Rendering ----
    function renderResult({ domain, config, cloud, realm, graphInfo }) {
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
            graph_info: graphInfo || null
        }, null, 2);

        els.card.hidden = false;
        els.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

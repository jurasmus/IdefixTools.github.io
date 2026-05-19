/* ========================================
   Entra ID Tenant Lookup
   Pure-browser reverse lookup via Microsoft's
   public OpenID Connect discovery endpoints.
   ======================================== */

(function () {
    'use strict';

    const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Known public Microsoft cloud instances
    const CLOUDS = [
        { host: 'login.microsoftonline.com',        type: 'Commercial / Worldwide' },
        { host: 'login.microsoftonline.us',         type: 'US Government (GCC High / DoD)' },
        { host: 'login.partner.microsoftonline.cn', type: 'China (operated by 21Vianet)' }
    ];

    const REGION_SCOPES = {
        'NA': 'North America',
        'EU': 'Europe',
        'AS': 'Asia',
        'OC': 'Oceania (Australia / New Zealand)',
        'AF': 'Africa',
        'SA': 'South America',
        'ME': 'Middle East',
        'WW': 'Worldwide',
        'USG': 'US Government',
        'USGov': 'US Government',
        'USL4': 'US Government (IL4)',
        'USL5': 'US Government (IL5 / DoD)'
    };

    // DOM
    const els = {
        input:       document.getElementById('tenantInput'),
        btn:         document.getElementById('lookupBtn'),
        chips:       document.querySelectorAll('.tl-chip'),
        section:     document.getElementById('resultsSection'),
        status:      document.getElementById('statusBox'),
        card:        document.getElementById('resultsCard'),
        cloudBadge:  document.getElementById('cloudBadgeText'),
        copyBtn:     document.getElementById('copyJsonBtn'),
        raw:         document.getElementById('rawJson'),
        f: {
            tenantId:      document.getElementById('fTenantId'),
            cloudInstance: document.getElementById('fCloudInstance'),
            cloudType:     document.getElementById('fCloudType'),
            regionScope:   document.getElementById('fRegionScope'),
            regionSubScope:document.getElementById('fRegionSubScope'),
            region:        document.getElementById('fRegion'),
            issuer:        document.getElementById('fIssuer'),
            authEndpoint:  document.getElementById('fAuthEndpoint'),
            tokenEndpoint: document.getElementById('fTokenEndpoint')
        }
    };

    // ---- Events ----
    els.btn.addEventListener('click', runLookup);
    els.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runLookup();
    });
    els.chips.forEach((chip) => {
        chip.addEventListener('click', () => {
            els.input.value = chip.dataset.example;
            runLookup();
        });
    });
    els.copyBtn.addEventListener('click', copyJson);

    // ---- Main lookup ----
    async function runLookup() {
        const tenantId = (els.input.value || '').trim().toLowerCase();
        showSection();

        if (!tenantId) {
            return showError('Please enter a tenant ID (GUID).');
        }
        if (!GUID_RE.test(tenantId)) {
            return showError('That does not look like a valid GUID. Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
        }

        setLoading(true);
        hideStatus();
        els.card.hidden = true;

        try {
            const { config, cloud } = await discoverTenant(tenantId);
            renderResult(tenantId, config, cloud);
        } catch (err) {
            console.error(err);
            const msg = err && err.message
                ? err.message
                : 'Lookup failed. The tenant may not exist or the request was blocked.';
            showError(msg);
        } finally {
            setLoading(false);
        }
    }

    // Try each cloud's OpenID configuration endpoint until one resolves
    async function discoverTenant(tenantId) {
        let lastErr = null;

        for (const cloud of CLOUDS) {
            const url = `https://${cloud.host}/${tenantId}/v2.0/.well-known/openid-configuration`;
            try {
                const resp = await fetch(url, { method: 'GET', mode: 'cors' });
                if (resp.ok) {
                    const config = await resp.json();
                    return { config, cloud };
                }
                // 400 = tenant not found in this cloud; try the next
                lastErr = new Error(`HTTP ${resp.status} from ${cloud.host}`);
            } catch (e) {
                lastErr = e;
            }
        }

        throw new Error(
            'Tenant not found in any known Microsoft cloud (Commercial, US Gov, China). ' +
            'Verify the GUID is a real Entra ID tenant ID.'
        );
    }

    // ---- Rendering ----
    function renderResult(tenantId, config, cloud) {
        // Issuer typically: https://login.microsoftonline.com/{tid}/v2.0
        const issuerTid = extractTenantIdFromUrl(config.issuer) || tenantId;

        els.f.tenantId.textContent      = issuerTid;
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

        // Raw JSON
        els.raw.textContent = JSON.stringify(config, null, 2);

        els.card.hidden = false;
        els.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function extractTenantIdFromUrl(url) {
        if (!url) return null;
        const m = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        return m ? m[1] : null;
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
        } catch {
            /* ignore */
        }
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
})();

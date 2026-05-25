document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("config-form");
    const evaluateBtn = document.getElementById("evaluate-btn");
    const btnSpinner = document.getElementById("btn-spinner");
    const btnLabel = document.getElementById("btn-label");
    const statsBody = document.getElementById("stats-body");
    const statusPill = document.getElementById("status-pill");
    const statusText = document.getElementById("status-text");
    const chartPlaceholder = document.getElementById("chart-placeholder");
    const schemesContainer = document.getElementById("schemes-container");
    const addSchemeBtn = document.getElementById("add-scheme-btn");
    const shareBtn = document.getElementById("share-btn");
    const toast = document.getElementById("toast");

    let schemeCounter = 0;

    // ── Scheme type definitions ──────────────────────────────────
    // Each type has a label, description, and a list of configurable parameters.
    const SCHEME_TYPES = {
        exact: {
            label: "Exact Dot Product",
            desc: "No intermediate rounding. Exact accumulation, single final round.",
            badge: "REF",
            params: [],
        },
        approx_mult: {
            label: "FP MUL + Exact Acc",
            desc: "Products rounded via FP MUL, then exactly accumulated.",
            params: [
                { key: "multPrec", label: "Mult Prec", type: "select", options: ["fp16", "fp32", "fp64"], default: "fp16" },
                { key: "resPrec", label: "Result Prec", type: "select", options: ["fp32", "fp64"], default: "fp32" },
            ],
        },
        approx_mult_acc: {
            label: "FP MUL + FP Add Tree",
            desc: "Products rounded, then accumulated via binary tree of rounded additions.",
            params: [
                { key: "multPrec", label: "Mult Prec", type: "select", options: ["fp16", "fp32", "fp64"], default: "fp16" },
                { key: "addPrec", label: "Add Prec", type: "select", options: ["fp16", "fp32", "fp64"], default: "fp16" },
                { key: "resPrec", label: "Result Prec", type: "select", options: ["fp32", "fp64"], default: "fp32" },
            ],
        },
        fma: {
            label: "Sequence of FMA",
            desc: "Fused multiply-add: one rounding per step (res = round(res + a×b)).",
            params: [
                { key: "fmaPrec", label: "FMA Prec", type: "select", options: ["fp32", "fp64"], default: "fp32" },
                { key: "resPrec", label: "Result Prec", type: "select", options: ["fp32", "fp64"], default: "fp32" },
            ],
        },
        bulk_norm: {
            label: "Bulk Normalization",
            desc: "Products rounded to fixed-point via round-to-odd, exponent from max product.",
            params: [
                { key: "bulkNormPrec", label: "Bulk Prec (bits)", type: "number", default: 25, min: 5, max: 60 },
                { key: "finalPrec", label: "Final Prec (bits)", type: "number", default: 24, min: 5, max: 60 },
            ],
        },
    };

    // ── Plotly dark layout template ────────────────────────────────
    const PLOTLY_LAYOUT = {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { family: "'Inter', sans-serif", color: "#8b9ec1", size: 12 },
        margin: { t: 24, r: 24, b: 52, l: 60 },
        xaxis: {
            title: { text: "Sorted sample index", standoff: 10 },
            gridcolor: "rgba(255,255,255,0.05)",
            zerolinecolor: "rgba(255,255,255,0.08)",
            linecolor: "rgba(255,255,255,0.08)",
        },
        yaxis: {
            title: { text: "Relative error", standoff: 10 },
            type: "log",
            gridcolor: "rgba(255,255,255,0.05)",
            zerolinecolor: "rgba(255,255,255,0.08)",
            linecolor: "rgba(255,255,255,0.08)",
        },
        legend: {
            orientation: "h",
            yanchor: "top", y: -0.18,
            xanchor: "center", x: 0.5,
            font: { size: 11 },
            bgcolor: "rgba(0,0,0,0)",
        },
        hoverlabel: {
            bgcolor: "#0f172a",
            bordercolor: "rgba(255,255,255,0.15)",
            font: { color: "#edf2f7", family: "'JetBrains Mono', monospace", size: 12 },
        },
        hovermode: "x unified",
    };

    const PLOTLY_CONFIG = {
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
        modeBarButtonsToRemove: ["lasso2d", "select2d"],
    };

    // ── Curated colour palette ────────────────────────────────────
    const SCHEME_COLORS = [
        "#f87171", "#60a5fa", "#34d399", "#a78bfa", "#fbbf24",
        "#f472b6", "#38bdf8", "#fb923c", "#4ade80", "#c084fc",
        "#e879f9", "#22d3ee", "#facc15", "#a3e635", "#fb7185",
    ];

    // ═══════════════════════════════════════════════════════════════
    //  Dynamic scheme card management
    // ═══════════════════════════════════════════════════════════════

    /** Build the parameter options HTML for a given scheme type key */
    function buildParamsHTML(typeKey, initialParams = {}) {
        const typeDef = SCHEME_TYPES[typeKey];
        if (!typeDef || typeDef.params.length === 0) return "";

        let html = '<div class="scheme-options">';
        for (const p of typeDef.params) {
            html += '<div class="input-group input-sm">';
            html += `<label>${p.label}</label>`;
            const val = initialParams[p.key] !== undefined ? initialParams[p.key] : p.default;
            if (p.type === "select") {
                html += `<select data-param="${p.key}" class="scheme-param">`;
                for (const opt of p.options) {
                    const sel = opt == val ? " selected" : "";
                    html += `<option value="${opt}"${sel}>${opt.toUpperCase()}</option>`;
                }
                html += "</select>";
            } else if (p.type === "number") {
                html += `<input type="number" data-param="${p.key}" class="scheme-param" value="${val}" min="${p.min}" max="${p.max}">`;
            }
            html += "</div>";
        }
        html += "</div>";
        return html;
    }

    /** Create and append a new scheme card */
    function addSchemeCard(initialType = "exact", initialParams = {}, isActive = true) {
        const id = schemeCounter++;
        const card = document.createElement("div");
        card.className = "scheme-card" + (isActive ? " active" : "");
        card.dataset.schemeId = id;

        const typeDef = SCHEME_TYPES[initialType];
        const badgeHTML = typeDef.badge
            ? `<span class="scheme-badge badge-reference">${typeDef.badge}</span>`
            : "";

        card.innerHTML = `
            <div class="scheme-header">
                <div class="scheme-header-left">
                    <label class="toggle-label">
                        <input type="checkbox" class="scheme-toggle" ${isActive ? "checked" : ""}>
                        <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    </label>
                    <select class="scheme-type-select">
                        ${Object.entries(SCHEME_TYPES)
                            .map(([key, def]) => `<option value="${key}"${key === initialType ? " selected" : ""}>${def.label}</option>`)
                            .join("")}
                    </select>
                </div>
                <div class="scheme-header-right">
                    ${badgeHTML}
                    <button type="button" class="remove-scheme-btn" title="Remove scheme" aria-label="Remove scheme">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>
            <p class="scheme-desc">${typeDef.desc}</p>
            <div class="scheme-params-slot">
                ${buildParamsHTML(initialType, initialParams)}
            </div>
        `;

        // Wire up type selector
        const typeSelect = card.querySelector(".scheme-type-select");
        typeSelect.addEventListener("change", () => {
            const newType = typeSelect.value;
            const newDef = SCHEME_TYPES[newType];
            card.querySelector(".scheme-desc").textContent = newDef.desc;
            card.querySelector(".scheme-params-slot").innerHTML = buildParamsHTML(newType);

            // Update badge
            const headerRight = card.querySelector(".scheme-header-right");
            const existingBadge = headerRight.querySelector(".scheme-badge");
            if (existingBadge) existingBadge.remove();
            if (newDef.badge) {
                const badge = document.createElement("span");
                badge.className = "scheme-badge badge-reference";
                badge.textContent = newDef.badge;
                headerRight.insertBefore(badge, headerRight.firstChild);
            }
        });

        // Wire up toggle
        const toggle = card.querySelector(".scheme-toggle");
        toggle.addEventListener("change", () => {
            card.classList.toggle("active", toggle.checked);
        });

        // Wire up remove button
        card.querySelector(".remove-scheme-btn").addEventListener("click", () => {
            card.style.animation = "fadeSlideOut 0.25s ease forwards";
            card.addEventListener("animationend", () => card.remove(), { once: true });
        });

        schemesContainer.appendChild(card);

        // Animate entrance
        card.style.animation = "fadeSlideIn 0.25s ease";
        card.addEventListener("animationend", () => { card.style.animation = ""; }, { once: true });

        return card;
    }

    // "Add Scheme" button
    addSchemeBtn.addEventListener("click", () => {
        addSchemeCard("bulk_norm");
    });

    // ═══════════════════════════════════════════════════════════════
    //  State sharing & restoring
    // ═══════════════════════════════════════════════════════════════

    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add("visible");
        setTimeout(() => toast.classList.remove("visible"), 2500);
    }

    shareBtn.addEventListener("click", () => {
        const state = buildRequest();
        const json = JSON.stringify(state);
        const b64 = btoa(encodeURIComponent(json));
        const url = new URL(window.location.href);
        url.hash = "state=" + b64;
        
        navigator.clipboard.writeText(url.toString()).then(() => {
            showToast("URL copied to clipboard!");
            window.history.replaceState(null, "", url.toString());
        }).catch(() => {
            showToast("Failed to copy URL");
        });
    });

    function restoreStateFromHash() {
        const hash = window.location.hash;
        if (!hash.startsWith("#state=")) return false;
        
        try {
            const b64 = hash.substring(7);
            const json = decodeURIComponent(atob(b64));
            const state = JSON.parse(json);

            // Restore form fields
            if (state.n) document.getElementById("cfg-n").value = state.n;
            if (state.k) document.getElementById("cfg-k").value = state.k;
            if (state.average) document.getElementById("cfg-avg").value = state.average;
            if (state.sigma) document.getElementById("cfg-sigma").value = state.sigma;
            if (state.inputPrec) document.getElementById("cfg-input-prec").value = state.inputPrec;

            // Clear container and restore schemes
            schemesContainer.innerHTML = "";
            state.schemes.forEach(s => {
                addSchemeCard(s.variant, s, true);
            });
            
            return true;
        } catch (err) {
            console.error("Failed to restore state", err);
            return false;
        }
    }

    // ── Create default scheme cards on page load ─────────────────
    if (restoreStateFromHash()) {
        // Automatically evaluate if state was restored from URL
        setTimeout(() => evaluateBtn.click(), 50);
    } else {
        addSchemeCard("exact");
        addSchemeCard("approx_mult");
        addSchemeCard("approx_mult_acc");
        addSchemeCard("fma");
        addSchemeCard("bulk_norm");
    }

    // ═══════════════════════════════════════════════════════════════
    //  Build request payload
    // ═══════════════════════════════════════════════════════════════

    function buildRequest() {
        const fd = new FormData(form);
        const schemes = [];

        schemesContainer.querySelectorAll(".scheme-card").forEach((card) => {
            const toggle = card.querySelector(".scheme-toggle");
            if (!toggle.checked) return;

            const variant = card.querySelector(".scheme-type-select").value;
            const entry = { variant };

            // Collect per-scheme parameters
            card.querySelectorAll(".scheme-param").forEach((param) => {
                entry[param.dataset.param] = param.value;
            });

            entry.name = buildSchemeName(variant, entry);
            schemes.push(entry);
        });

        return {
            n: parseInt(fd.get("n")) || 1000,
            k: parseInt(fd.get("k")) || 2,
            average: parseFloat(fd.get("average")) || 5.0,
            sigma: parseFloat(fd.get("sigma")) || 5.0,
            inputPrec: fd.get("inputPrec") || "fp16",
            schemes,
        };
    }

    function buildSchemeName(variant, params) {
        switch (variant) {
            case "exact":
                return "Exact Dot Product";
            case "approx_mult":
                return `FP MUL [${(params.multPrec || "fp16").toUpperCase()}] + Exact Acc`;
            case "approx_mult_acc":
                return `FP MUL [${(params.multPrec || "fp16").toUpperCase()}] + Add Tree [${(params.addPrec || "fp16").toUpperCase()}]`;
            case "fma":
                return `FMA [${(params.fmaPrec || "fp32").toUpperCase()}]`;
            case "bulk_norm":
                return `Bulk Norm [Fixed ${params.bulkNormPrec || 25}, Final ${params.finalPrec || 24}]`;
            default:
                return variant;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Status & formatting helpers
    // ═══════════════════════════════════════════════════════════════

    function setStatus(state, text) {
        statusPill.className = "status-pill" + (state ? ` ${state}` : "");
        statusText.textContent = text;
    }

    function fmtSci(num) {
        if (num === 0) return "0";
        if (!isFinite(num)) return "∞";
        return num.toExponential(3);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Evaluate
    // ═══════════════════════════════════════════════════════════════

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const payload = buildRequest();
        if (payload.schemes.length === 0) {
            setStatus("error", "No schemes enabled");
            return;
        }

        // UI → loading
        evaluateBtn.disabled = true;
        btnLabel.style.display = "none";
        btnSpinner.style.display = "block";
        setStatus("loading", "Evaluating…");
        statsBody.innerHTML = `<tr><td colspan="5" class="empty-state">Computing…</td></tr>`;

        try {
            const resp = await fetch("/api/evaluate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!resp.ok) throw new Error(`Server error ${resp.status}`);
            const data = await resp.json();
            renderResults(data, payload.n);
            setStatus("", "Done");
        } catch (err) {
            console.error(err);
            setStatus("error", "Error");
            statsBody.innerHTML = `<tr><td colspan="5" class="empty-state" style="color:var(--error)">Evaluation failed — ${err.message}</td></tr>`;
        } finally {
            evaluateBtn.disabled = false;
            btnLabel.style.display = "inline";
            btnSpinner.style.display = "none";
        }
    });

    // ═══════════════════════════════════════════════════════════════
    //  Render results
    // ═══════════════════════════════════════════════════════════════

    function renderResults(data, n) {
        chartPlaceholder.classList.add("hidden");

        const traces = [];
        statsBody.innerHTML = "";

        const entries = Object.entries(data);

        entries.forEach(([schemeName, results], idx) => {
            const color = SCHEME_COLORS[idx % SCHEME_COLORS.length];

            // Plotly trace
            const yData = results.sorted_rel_errors.map((v) => (v === 0 ? null : v));
            const xData = Array.from({ length: yData.length }, (_, i) => i);

            traces.push({
                x: xData,
                y: yData,
                type: "scattergl",
                mode: "lines",
                name: schemeName,
                line: { color, width: 2 },
                hovertemplate: "%{y:.4e}<extra>" + schemeName + "</extra>",
            });

            // Stats table row
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>
                    <span class="scheme-label">
                        <span class="color-dot" style="background:${color}"></span>
                        ${schemeName}
                    </span>
                </td>
                <td>${fmtSci(results.min)}</td>
                <td>${fmtSci(results.max)}</td>
                <td>${fmtSci(results.geometric_mean)}</td>
                <td>${results.exact_count}</td>
            `;
            statsBody.appendChild(tr);
        });

        // Render Plotly chart
        const chartDiv = document.getElementById("plotly-chart");
        const wrap = document.getElementById("chart-wrap");
        const layout = {
            ...PLOTLY_LAYOUT,
            showlegend: true,
            autosize: true,
            height: Math.max(wrap.clientHeight, 450),
        };

        Plotly.react(chartDiv, traces, layout, PLOTLY_CONFIG);
    }
});

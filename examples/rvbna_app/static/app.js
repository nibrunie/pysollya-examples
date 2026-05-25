document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("config-form");
    const evaluateBtn = document.getElementById("evaluate-btn");
    const btnSpinner = document.getElementById("btn-spinner");
    const btnLabel = document.getElementById("btn-label");
    const statsBody = document.getElementById("stats-body");
    const statusPill = document.getElementById("status-pill");
    const statusText = document.getElementById("status-text");
    const chartPlaceholder = document.getElementById("chart-placeholder");

    // ── Plotly dark layout template ────────────────────────────────
    const PLOTLY_LAYOUT = {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: {
            family: "'Inter', sans-serif",
            color: "#8b9ec1",
            size: 12,
        },
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
            yanchor: "top",
            y: -0.18,
            xanchor: "center",
            x: 0.5,
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
        "#f87171", // red
        "#60a5fa", // blue
        "#34d399", // emerald
        "#a78bfa", // violet
        "#fbbf24", // amber
        "#f472b6", // pink
        "#38bdf8", // sky
        "#fb923c", // orange
        "#4ade80", // green
        "#c084fc", // purple
    ];

    // ── Scheme card active state management ───────────────────────
    document.querySelectorAll(".scheme-toggle").forEach((toggle) => {
        const card = toggle.closest(".scheme-card");
        function syncActive() {
            card.classList.toggle("active", toggle.checked);
        }
        syncActive();
        toggle.addEventListener("change", syncActive);
    });

    // ── Build request payload from form ──────────────────────────
    function buildRequest() {
        const fd = new FormData(form);
        const schemes = [];

        document.querySelectorAll(".scheme-toggle:checked").forEach((toggle) => {
            const variant = toggle.dataset.scheme;
            const card = toggle.closest(".scheme-card");
            const entry = { variant };

            // Collect per-scheme parameters from the card
            card.querySelectorAll(".scheme-param").forEach((param) => {
                const key = param.dataset.param;
                const val = param.value;
                entry[key] = val;
            });

            // Build a human-readable name
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

    // ── Status helpers ────────────────────────────────────────────
    function setStatus(state, text) {
        statusPill.className = "status-pill" + (state ? ` ${state}` : "");
        statusText.textContent = text;
    }

    // ── Format scientific notation ────────────────────────────────
    function fmtSci(num) {
        if (num === 0) return "0";
        if (!isFinite(num)) return "∞";
        return num.toExponential(3);
    }

    // ── Evaluate ──────────────────────────────────────────────────
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const payload = buildRequest();
        if (payload.schemes.length === 0) {
            setStatus("error", "No schemes selected");
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

    // ── Render results ────────────────────────────────────────────
    function renderResults(data, n) {
        // Hide placeholder
        chartPlaceholder.classList.add("hidden");

        const traces = [];
        statsBody.innerHTML = "";

        const entries = Object.entries(data);

        entries.forEach(([schemeName, results], idx) => {
            const color = SCHEME_COLORS[idx % SCHEME_COLORS.length];

            // ── Plotly trace ──
            // Filter out zero values for log scale (replace with null)
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

            // ── Stats table row ──
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

        // ── Render Plotly chart ──
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

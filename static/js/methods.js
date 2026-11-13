/* Phase 6/7: methods, source attribution, limitations and compliance notes. */
(function () {
  "use strict";

  const state = { built: false };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => window.FieldShiftApp.escapeHtml(value);

  const SOURCES = [
    {
      name: "NASA POWER — Daily Point API",
      role: "Temperature, precipitation, solar radiation, humidity, wind and model root-zone wetness for the selected coordinate.",
      resolution: "0.5° × 0.5° grid cell (daily point API)",
      coverage: "1981-01-01 to near real time; several days latency",
      access: "Public, no login",
      url: "https://power.larc.nasa.gov/",
      docs: "https://power.larc.nasa.gov/docs/services/api/temporal/daily/",
    },
    {
      name: "NASA SMAP — SPL3SMP_E V006",
      role: "Satellite soil-moisture context. This MVP displays public GIBS imagery and CMR granule metadata; it does not claim a numeric SMAP point value.",
      resolution: "9 km enhanced L3 product",
      coverage: "Global daily product; imagery dates depend on GIBS processing",
      access: "Imagery/metadata public; quantitative granules require Earthdata Login",
      url: "https://nsidc.org/data/spl3smp_e",
      docs: "https://doi.org/10.5067/OMEAKG6GJ1Q2",
    },
    {
      name: "NASA GPM IMERG Late Run — GPM_3IMERGDL V07",
      role: "Precipitation context. Public GIBS imagery and CMR granule metadata; quantitative access is not enabled.",
      resolution: "0.1° × 0.1°",
      coverage: "Global, 2000-present (Late Run); latest granule verified during development",
      access: "Imagery/metadata public; quantitative granules require Earthdata Login",
      url: "https://gpm.nasa.gov/data/imerg",
      docs: "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGDL_07/summary",
    },
    {
      name: "NASA MODIS — MOD13Q1 V061",
      role: "Vegetation-index context. Public GIBS NDVI imagery and CMR granule metadata; quantitative access is not enabled.",
      resolution: "250 m, 16-day composite",
      coverage: "Global, 2000-present",
      access: "Imagery/metadata public; quantitative granules require Earthdata Login",
      url: "https://lpdaac.usgs.gov/products/mod13q1v061/",
      docs: "https://doi.org/10.5067/MODIS/MOD13Q1.061",
    },
  ];

  function build() {
    $("methods-app").innerHTML = `
      <div class="alert alert-info" style="margin-bottom:18px">
        <div>
          <strong>Independent prototype — NASA does not endorse this application.</strong>
          <p>Field Shift is an Egypt-focused decision-support prototype built for the 2026 NASA Space Apps Challenge. It separates measured data, satellite/model estimates, user inputs and calculated indicators.</p>
        </div>
      </div>

      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Data provenance</p>
            <h2>NASA sources and what each one contributes</h2>
          </div>
          <span class="tag">Official product links</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Source</th><th>Role here</th><th>Resolution</th><th>Coverage</th><th>Access</th><th>Official links</th></tr></thead>
            <tbody>
              ${SOURCES.map((source) => `
                <tr>
                  <td><strong>${esc(source.name)}</strong></td>
                  <td>${esc(source.role)}</td>
                  <td>${esc(source.resolution)}</td>
                  <td>${esc(source.coverage)}</td>
                  <td>${esc(source.access)}</td>
                  <td><a href="${esc(source.url)}" target="_blank" rel="noopener">Product</a><br><a href="${esc(source.docs)}" target="_blank" rel="noopener">Documentation</a></td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <p class="provenance-note">Retrieval timestamps, observation dates and unit metadata are stored with every NASA POWER response and shown in the Climate tab and local SQLite database. NASA GIBS/CMR checks are timestamped in the Satellite tab.</p>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Evidence types</p>
            <h2>What is measured, modelled, entered or calculated</h2>
          </div>
        </div>
        <div class="method-grid">
          <div class="surface-card method-card">
            <span class="tag tag-nasa">NASA observation / model estimate</span>
            <h3 style="margin-top:8px">Grid-cell climate and imagery</h3>
            <p>POWER variables are assimilated/model-derived estimates for a grid cell, not an on-farm sensor reading. SMAP, GPM and MODIS cards show rendered NASA GIBS imagery and verify that CMR granules exist; they do not display a numeric satellite value.</p>
          </div>
          <div class="surface-card method-card">
            <span class="tag tag-user">User input</span>
            <h3 style="margin-top:8px">Soil and farm context</h3>
            <p>Texture, pH, organic matter, EC, drainage, irrigation and water source are entered by the user and stored locally in SQLite. Blank fields remain blank; they are not filled with regional averages.</p>
          </div>
          <div class="surface-card method-card">
            <span class="tag">Reference dataset</span>
            <h3 style="margin-top:8px">Egyptian governorate and crop traits</h3>
            <p>Governorate summaries and crop characteristics are curated reference ranges from FAO sources. They are not a farm soil test, variety trial or official governorate statistic. The application labels them as reference data wherever they appear.</p>
          </div>
          <div class="surface-card method-card">
            <span class="tag tag-calc">Calculated indicator</span>
            <h3 style="margin-top:8px">Risk screens, rotation scores and soil classes</h3>
            <p>Climate-risk signals, factor scores, weighted totals, sensitivity bands and rotation briefs are deterministic rules applied to the inputs above. They are exploratory indicators, not forecasts, official warnings, yield, profit, water-use or food-security predictions.</p>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Climate-risk screening</p>
            <h2>Five fixed rules, every threshold visible</h2>
          </div>
        </div>
        <div class="method-grid">
          <div class="surface-card method-card">
            <h3>Signals and thresholds</h3>
            <ul>
              <li><strong>Heat stress</strong> — days with <code>T2M_MAX</code> ≥35 °C; high at ≥30% of valid days or ≥3 days ≥40 °C.</li>
              <li><strong>Dry spell</strong> — days with <code>PRECTOTCORR</code> &lt;1 mm; high at ≥90% of days or a run ≥30 days.</li>
              <li><strong>Heavy rain</strong> — days ≥10 mm; high at ≥3 such days.</li>
              <li><strong>Strong wind</strong> — days with <code>WS2M</code> ≥6 m/s; high at ≥20% of valid days.</li>
              <li><strong>Low humidity</strong> — days with mean <code>RH2M</code> &lt;20%; high at ≥30% of valid days.</li>
            </ul>
          </div>
          <div class="surface-card method-card">
            <h3>What the screen does and does not mean</h3>
            <p>Each card reports the observed count, the longest run where relevant, the source variable and a caveat. Coverage below 80% is stated and lowers confidence. Missing days are excluded, never replaced with zero or a regional average.</p>
            <p>The screen describes the <strong>selected historical period</strong>. It is not a forecast, an official meteorological warning or a crop-loss model. Rain is not irrigation, and air temperature alone does not measure crop heat stress; growth stage, humidity, wind, soil water and management also matter.</p>
            <p>The heat and dry-spell pressures use the same POWER inputs as the rotation climate-resilience factor, but the screen does not change the user's weights automatically.</p>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Rotation method</p>
            <h2>Five factors, configurable weights, explicit uncertainty</h2>
          </div>
        </div>
        <div class="method-grid">
          <div class="surface-card method-card">
            <h3>Factors</h3>
            <ul>
              <li><strong>Water balance</strong> — crop water-demand levels against the stated irrigation system.</li>
              <li><strong>Salinity fit</strong> — crop ECe thresholds against user EC, or a lower-confidence tolerance-only score.</li>
              <li><strong>Climate resilience</strong> — crop heat/drought traits against NASA POWER heat-day and rain-scarcity pressures.</li>
              <li><strong>Soil protection</strong> — cover/residue traits with an organic-matter caveat.</li>
              <li><strong>Diversity &amp; continuity</strong> — legume share, family diversity and season alternation.</li>
            </ul>
          </div>
          <div class="surface-card method-card">
            <h3>Uncertainty and limitations</h3>
            <p>The displayed range propagates independent factor uncertainty: <code>σ = √Σ(weight × uncertainty)²</code>, shown as an 80% sensitivity band. It is not a calibrated confidence interval.</p>
            <p>The ranking can change when weights change; a small score gap is not a decisive recommendation. Crop traits vary by variety, soil and management. Local trials and extension advice take precedence.</p>
          </div>
        </div>
        <div class="score-formula">score = Σ(normalised weight × factor score) / Σ weights of available factors</div>
        <p class="provenance-note">Crop and salinity references: FAO Irrigation and Drainage Papers 56 and 29, FAO EcoCrop and FAO Crop Calendar. Governorate context is a regional synthesis with source links in the Farm tab.</p>
        <p class="provenance-note">The decision brief reports the leader-to-runner gap, band separation, the strongest and weakest contributing factors, per-scenario risk flags below 50/100, and missing-input checks. Band overlap is a sensitivity check, not a statistical confidence interval or a probability of better performance.</p>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Known limitations</p>
            <h2>What this MVP does not do</h2>
          </div>
        </div>
        <div class="method-grid">
          <div class="surface-card method-card">
            <h3>Data and access</h3>
            <ul>
              <li>No quantitative SMAP, GPM or MODIS point extraction: NASA Earthdata Login is required and no credentials are requested or stored.</li>
              <li>No farm sensors, field boundaries, yield records or economic data.</li>
              <li>POWER is a grid-cell product with several days of latency; it is not local weather-station data.</li>
              <li>Climate-risk thresholds are fixed screening rules, not locally calibrated forecasts or official warnings.</li>
              <li>Governorate reference data are regional syntheses, not farm measurements.</li>
            </ul>
          </div>
          <div class="surface-card method-card">
            <h3>Scientific scope</h3>
            <ul>
              <li>No yield, profit, water-saving or soil-carbon prediction is made.</li>
              <li>No pesticide, fertilizer or irrigation schedule is prescribed.</li>
              <li>Egyptian crop rules are deliberately not transferred outside Egypt.</li>
              <li>Rotation scenarios are editable examples, not recommendations.</li>
            </ul>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Transparency</p>
            <h2>AI usage and challenge alignment</h2>
          </div>
          <a class="btn btn-small btn-ghost" href="https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/" target="_blank" rel="noopener">Official challenge ↗</a>
        </div>
        <div class="method-grid">
          <div class="surface-card method-card">
            <h3>AI usage disclosure</h3>
            <p>AI assistance (DeepSeek V4.1 Flash Free via the OpenCode coding agent) was used to help write application code, tests, interface text and documentation. AI output was checked against the cited NASA, FAO and geospatial sources and against live API responses.</p>
            <p>AI-generated text is not presented as a verified scientific finding. Agricultural assumptions remain simplified reference rules and require specialist review before real-world use. NASA branding is not used to imply endorsement.</p>
          </div>
          <div class="surface-card method-card">
            <h3>Challenge mapping</h3>
            <p><strong>NASA Earth observations</strong> → POWER climate, GIBS/CMR satellite context. <strong>Local soil information</strong> → user soil profile and governorate reference context. <strong>Crop characteristics</strong> → 22-crop reference trait set. <strong>Farmer priorities</strong> → configurable factor weights. <strong>Rotation exploration</strong> → four transparent scenarios.</p>
            <p class="ref">See the project README for the full requirement-to-feature audit and test commands.</p>
          </div>
        </div>
      </section>`;
  }

  function init() {
    if (state.built) return;
    build();
    state.built = true;
  }

  window.FieldShiftMethods = { init };
})();

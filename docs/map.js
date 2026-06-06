/* =================================================================
   UNCmap — interactive housing map for UNC Chapel Hill.
   Vanilla Leaflet + markercluster. Data is loaded from ./data/*.json
   so it is trivial to expand in later steps (exhaustive listing sweep).
   ================================================================= */
(function () {
  "use strict";

  var ICONS = window.UNC_ICONS || {};
  var UNC_CENTER = [35.9088, -79.0479];

  // ---- category style config (color + glyph + pin shape) -----------
  var AMENITY = {
    supermarket: { label: "Groceries",    color: "#2E9E5B", icon: "supermarket", shape: "drop" },
    dining:      { label: "Dining",       color: "#E8643C", icon: "dining",      shape: "drop" },
    shopping:    { label: "Shopping",     color: "#9B5DE5", icon: "shopping",    shape: "drop" },
    park:        { label: "Parks & green",color: "#1FA98F", icon: "park",        shape: "drop" },
    attraction:  { label: "Attractions",  color: "#E0A100", icon: "attraction",  shape: "drop" }
  };
  var HOUSING = {
    apartment:    { label: "Apartments",        color: "#4361EE", icon: "apartment",    shape: "tag" },
    townhouse:    { label: "Townhouses",        color: "#B5713B", icon: "townhouse",    shape: "tag" },
    condo:        { label: "Condo / community", color: "#2BA6A0", icon: "condo",        shape: "tag" },
    house_rental: { label: "House rentals",     color: "#D6477E", icon: "house_rental", shape: "tag" },
    mixed_use:    { label: "Mixed-use",         color: "#7A6CF0", icon: "apartment",    shape: "tag" }
  };
  var DEST_COLOR = "#4B9CD3"; // Carolina Blue

  // normalize odd category strings coming from research
  function normAmenity(c) {
    c = (c || "").toLowerCase();
    if (c === "grocery") return "supermarket";
    if (c === "restaurant_strip" || c === "restaurant" || c === "dining_district") return "dining";
    if (c === "retail_center" || c === "retail") return "shopping";
    if (c === "green_space" || c === "park_green") return "park";
    if (c === "landmark") return "attraction";
    return AMENITY[c] ? c : "attraction";
  }
  function normHousing(t) {
    t = (t || "").toLowerCase();
    if (HOUSING[t]) return t;
    if (t === "condos") return "condo";
    if (t === "house" || t === "rental_house") return "house_rental";
    return "apartment";
  }

  // ---- marker icon builder -----------------------------------------
  function pinIcon(style) {
    var glyph = ICONS[style.icon] || "";
    var isDest = style.shape === "dest";
    var shapeClass = isDest ? "unc-pin--drop unc-pin--dest"
                   : style.shape === "tag" ? "unc-pin--tag" : "unc-pin--drop";
    var size = isDest ? 42 : style.small ? 26 : 30;
    var html =
      '<div class="unc-pin ' + shapeClass + '" style="--pin:' + style.color + '">' +
        '<div class="unc-pin__badge"><span class="unc-pin__glyph">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true">' + glyph + "</svg>" +
        "</span></div></div>";
    return L.divIcon({
      html: html, className: "unc-pin-wrap",
      iconSize: [size, size], iconAnchor: [size / 2, size], popupAnchor: [0, -size + 4]
    });
  }

  // ---- map + basemap (theme-aware) ---------------------------------
  var map = L.map("map", { zoomControl: true, center: UNC_CENTER, zoom: 14, preferCanvas: false });
  var CARTO = "https://{s}.basemaps.cartocdn.com/";
  var ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
  function tiles(variant) {
    return L.tileLayer(CARTO + variant + "/{z}/{x}/{y}{r}.png",
      { subdomains: "abcd", maxZoom: 20, attribution: ATTR });
  }
  var lightTiles = tiles("light_all"), darkTiles = tiles("dark_all");
  function isDark() { return document.documentElement.classList.contains("dark"); }
  var current = null;
  function applyBasemap() {
    var want = isDark() ? darkTiles : lightTiles;
    if (current !== want) {
      if (current) map.removeLayer(current);
      want.addTo(map); want.bringToBack(); current = want;
    }
    if (typeof routePairs !== "undefined" && routePairs) {
      var cc = isDark() ? "#000" : "#fff";
      routePairs.forEach(function (p) { p.casing.setStyle({ color: cc }); });
    }
  }
  applyBasemap();
  new MutationObserver(applyBasemap).observe(document.documentElement,
    { attributes: true, attributeFilter: ["class"] });

  // ---- layer containers --------------------------------------------
  var amenityLayers = {};   // cat -> L.layerGroup
  Object.keys(AMENITY).forEach(function (k) { amenityLayers[k] = L.layerGroup(); });
  var campusLayer = L.layerGroup().addTo(map);   // UNC campus outline (drawn under routes)
  var destLayer = L.layerGroup().addTo(map);
  var zoneLayer = L.layerGroup().addTo(map);
  var routesLayer = L.layerGroup().addTo(map);   // manual routes (chip-controlled)
  var focusLayer = L.layerGroup().addTo(map);    // ephemeral highlight (marker / route click)
  var routePolys = {};   // id -> [casing, line]
  var routeIndex = {};   // id -> { rt, pts, line, casing }
  var routePairs = [];   // [{casing, line}] — for zoom-responsive width
  var campusPolys = [];  // campus outline polygons — for zoom-responsive width

  // default-OFF layers: bus lines, dining, parks, attractions start unchecked
  var AMENITY_DEFAULT = { supermarket: true, dining: false, shopping: true, park: false, attraction: false };

  // housing: a plain layer group per type (NO clustering — show every icon as-is,
  // no "2 / 3 / 4" count bubbles even when markers overlap)
  var housingLayers = {}; // type -> L.layerGroup
  Object.keys(HOUSING).forEach(function (k) { housingLayers[k] = L.layerGroup().addTo(map); });

  // ---- zoom-responsive (无极) line widths --------------------------
  function lineW(z) { return Math.max(1.3, Math.min(4.6, (z - 11) * 0.55 + 1.7)); }
  function updateWeights() {
    var w = lineW(map.getZoom());
    routePairs.forEach(function (p) {
      p.line.setStyle({ weight: w });
      p.casing.setStyle({ weight: w + 2.1 });
    });
    campusPolys.forEach(function (poly) { poly.setStyle({ weight: Math.max(1.1, w - 0.9) }); });
  }
  map.on("zoomend", updateWeights);

  // ---- related bus lines (which routes link a place to the destination) -----
  function distToRoute(lat, lng, pts) {           // min point→polyline distance (m)
    var R = 6371000, toR = Math.PI / 180, cosLat = Math.cos(lat * toR);
    function X(ln) { return R * ln * toR * cosLat; }
    function Y(la) { return R * la * toR; }
    var px = X(lng), py = Y(lat), min = Infinity;
    for (var i = 1; i < pts.length; i++) {
      var ax = X(pts[i - 1][1]), ay = Y(pts[i - 1][0]);
      var bx = X(pts[i][1]), by = Y(pts[i][0]);
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      var t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var cx = ax + t * dx, cy = ay + t * dy, d = Math.hypot(px - cx, py - cy);
      if (d < min) min = d;
    }
    return min;
  }
  function relevantRoutes(lat, lng) {             // routes near BOTH this point and the destination
    if (!DEST) return [];
    var out = [];
    Object.keys(routeIndex).forEach(function (id) {
      var r = routeIndex[id], dHere = distToRoute(lat, lng, r.pts);
      if (dHere <= 500 && distToRoute(DEST.lat, DEST.lng, r.pts) <= 600) out.push({ id: id, d: dHere });
    });
    out.sort(function (a, b) { return a.d - b.d; });
    return out.slice(0, 6).map(function (o) { return o.id; });
  }
  function textOn(hex) {                           // readable text colour for a coloured pill
    var c = (hex || "#888888").replace("#", "");
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#1a1a1a" : "#ffffff";
  }
  function clearFocus() { focusLayer.clearLayers(); }
  // highlight the given routes in their OWN colour + name label; clears any prior highlight
  function focusRoutes(ids) {
    clearFocus();
    var w = lineW(map.getZoom());
    (ids || []).forEach(function (id) {
      var r = routeIndex[id]; if (!r) return;
      var col = r.rt.color || "#888";
      L.polyline(r.pts, { color: col, weight: w + 6, opacity: 0.22, lineJoin: "round", lineCap: "round", interactive: false }).addTo(focusLayer);
      L.polyline(r.pts, { color: col, weight: w + 1.6, opacity: 1, lineJoin: "round", lineCap: "round", interactive: false }).addTo(focusLayer);
      var mid = r.pts[Math.floor(r.pts.length / 2)];
      L.marker(mid, { interactive: false, keyboard: false, icon: L.divIcon({
        className: "route-name-wrap", iconSize: [0, 0],
        html: '<div class="route-name__pill" style="background:' + col + ';color:' + textOn(col) + '">' +
              esc(r.rt.id + " · " + r.rt.name) + "</div>"
      }) }).addTo(focusLayer);
    });
  }
  map.on("click", clearFocus);   // click empty map → clear highlight

  var DEST = null; // destination record for directions

  // ---- detail panel -------------------------------------------------
  var detailEl = document.getElementById("detail");
  var detailBody = document.getElementById("detail-body");
  document.getElementById("detail-close").onclick = function () { detailEl.hidden = true; };

  function gmapDir(lat, lng) {
    var d = DEST ? "&destination=" + DEST.lat + "," + DEST.lng : "";
    return "https://www.google.com/maps/dir/?api=1&origin=" + lat + "," + lng + d + "&travelmode=transit";
  }
  function gmapAt(lat, lng) {
    // query by exact coordinates, not name — a name search returns every
    // same-named place nationwide instead of this one.
    return "https://www.google.com/maps/search/?api=1&query=" + lat + "," + lng;
  }
  function swatchHTML(style) {
    return '<span class="detail__swatch" style="background:' + style.color + '">' +
      '<svg viewBox="0 0 24 24">' + (ICONS[style.icon] || "") + "</svg></span>";
  }
  function openDetail(rec, style, catLabel) {
    var rows = "";
    if (rec.address) rows += "<dt>address</dt><dd>" + esc(rec.address) + "</dd>";
    if (rec.zone) rows += "<dt>neighborhood</dt><dd>" + esc(rec.zone) + "</dd>";
    if (rec.type) rows += "<dt>type</dt><dd>" + esc(rec.type.replace(/_/g, " ")) + "</dd>";
    rows += "<dt>coordinates</dt><dd>" + rec.lat.toFixed(5) + ", " + rec.lng.toFixed(5) +
      (rec.approx ? " <em>(approx)</em>" : "") + "</dd>";
    detailBody.innerHTML =
      '<div class="detail__cat">' + swatchHTML(style) + "<span>" + esc(catLabel) + "</span></div>" +
      '<div class="detail__name">' + esc(rec.name) + "</div>" +
      (rec.note ? '<div class="detail__note">' + esc(rec.note) + "</div>" : "") +
      '<dl class="detail__meta">' + rows + "</dl>" +
      '<div class="detail__actions">' +
        (rec.url ? '<a class="btn-link" target="_blank" rel="noopener" href="' + esc(rec.url) +
          '"><svg class="btn-glyph" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS.globe || "") +
          "</svg>Floor plans &amp; pricing</a>" : "") +
        (DEST ? '<a class="btn-link" target="_blank" rel="noopener" href="' + gmapDir(rec.lat, rec.lng) +
          '">↳ Transit directions to ' + esc(DEST.name) + "</a>" : "") +
        '<a class="btn-link" target="_blank" rel="noopener" href="' + gmapAt(rec.lat, rec.lng) +
          '">↗ Open in Google Maps</a>' +
      "</div>";
    detailEl.hidden = false;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]; }); }

  function makeMarker(rec, style, catLabel, originRoutes) {
    var m = L.marker([rec.lat, rec.lng], { icon: pinIcon(style), riseOnHover: true });
    m.bindTooltip(rec.name, { direction: "top", offset: [0, -10], opacity: 0.95 });
    m.on("click", function () {
      openDetail(rec, style, catLabel);
      // show the bus line(s) linking this place to the destination (cleared each click)
      focusRoutes(originRoutes ? relevantRoutes(rec.lat, rec.lng) : []);
    });
    return m;
  }

  // ---- data load ----------------------------------------------------
  Promise.all([
    fetch("./data/places.json").then(r => r.json()).catch(() => ({})),
    fetch("./data/housing.json").then(r => r.json()).catch(() => ({})),
    fetch("./data/routes.json").then(r => r.json()).catch(() => ({})),
    fetch("./data/campus.json").then(r => r.json()).catch(() => ({}))
  ]).then(function (res) {
    build(res[0] || {}, res[1] || {}, res[2] || {}, res[3] || {});
  });

  function build(places, housing, routes, campus) {
    var allLatLng = [];

    // --- UNC campus outline (real OSM boundary, drawn beneath routes) ---
    (campus.rings || []).forEach(function (ring) {
      var poly = L.polygon(ring, {
        color: DEST_COLOR, weight: 2, opacity: 0.95, dashArray: "5 5",
        fill: true, fillColor: DEST_COLOR, fillOpacity: 0.05,
        lineJoin: "round", smoothFactor: 1.2, interactive: false
      });
      poly.addTo(campusLayer); campusPolys.push(poly);
    });

    // --- destination + runner-ups ---
    if (places.destination) {
      var d = places.destination;
      DEST = { name: d.building, lat: d.lat, lng: d.lng };
      var dStyle = { label: "Destination", color: DEST_COLOR, icon: "destination", shape: "dest" };
      var dm = makeMarker({ name: d.building, lat: d.lat, lng: d.lng,
        note: d.reason, type: "commute destination" }, dStyle, "Commute destination");
      dm.addTo(destLayer); allLatLng.push([d.lat, d.lng]);
      // sidebar callout
      var dc = document.getElementById("dest-card");
      dc.hidden = false;
      document.getElementById("dest-name").textContent = d.building;
      document.getElementById("dest-why").textContent =
        (d.reason || "").replace(/\s+/g, " ").slice(0, 220) + ((d.reason || "").length > 220 ? "…" : "");
      // runner-ups (smaller, same colour, no pulse)
      (places.runner_up_buildings || []).forEach(function (b) {
        var rstyle = { label: "Alt. building", color: DEST_COLOR, icon: "school", shape: "drop", small: true };
        makeMarker({ name: b.building, lat: b.lat, lng: b.lng,
          note: "Secondary teaching building (" + (b.course_count || "?") + " upper-div meetings).",
          type: "alternate destination" }, rstyle, "Alt. teaching building").addTo(destLayer);
        allLatLng.push([b.lat, b.lng]);
      });
    }

    // --- amenities (0.2) ---
    var amenityCounts = {};
    Object.keys(AMENITY).forEach(function (k) { amenityCounts[k] = 0; });
    (places.places || []).forEach(function (p) {
      var cat = normAmenity(p.category);
      var style = AMENITY[cat];
      var rec = { name: p.name, lat: p.lat, lng: p.lng, note: p.note, address: p.address, approx: p.approx };
      makeMarker(rec, style, style.label, true).addTo(amenityLayers[cat]);
      amenityCounts[cat]++; allLatLng.push([p.lat, p.lng]);
    });
    Object.keys(amenityLayers).forEach(function (k) { if (AMENITY_DEFAULT[k]) amenityLayers[k].addTo(map); });

    // --- housing (0.3) ---
    var housingCounts = {};
    Object.keys(HOUSING).forEach(function (k) { housingCounts[k] = 0; });
    (housing.complexes || []).forEach(function (h) {
      var type = normHousing(h.type);
      var style = HOUSING[type];
      var rec = { name: h.name, lat: h.lat, lng: h.lng, note: h.note, zone: h.zone, type: type, approx: h.approx, url: h.url };
      makeMarker(rec, style, style.label, true).addTo(housingLayers[type]);
      housingCounts[type]++; allLatLng.push([h.lat, h.lng]);
    });

    // --- neighborhood/zone labels ---
    (housing.zones || []).forEach(function (z) {
      var label = '<div class="zone-label">' + esc(z.name) +
        (z.nickname ? "<small>" + esc(z.nickname) + "</small>" : "") + "</div>";
      L.marker([z.lat, z.lng], {
        icon: L.divIcon({ html: label, className: "zone-label-wrap", iconSize: [0, 0] }),
        interactive: false, keyboard: false
      }).addTo(zoneLayer);
    });

    // --- bus routes (0.4) — REAL on-street geometry from GTFS shapes.txt,
    //     so lines follow roads (no cutting through buildings) ---
    var w0 = lineW(map.getZoom());
    (routes.routes || []).forEach(function (rt) {
      var pts = (rt.geometry && rt.geometry.length >= 2) ? rt.geometry
        : (rt.waypoints || []).filter(function (w) { return w.lat && w.lng; })
            .map(function (w) { return [w.lat, w.lng]; });
      if (pts.length < 2) return;
      var casing = L.polyline(pts, { color: isDark() ? "#000" : "#fff", weight: w0 + 2.1, opacity: 0.5, lineJoin: "round", lineCap: "round", smoothFactor: 1, interactive: false });
      var line = L.polyline(pts, { color: rt.color || "#888", weight: w0, opacity: 0.92, lineJoin: "round", lineCap: "round", smoothFactor: 1 });
      line.bindTooltip(rt.id + " · " + rt.name, { sticky: true, opacity: 0.95 });
      line.on("click", function (e) {
        L.DomEvent.stopPropagation(e);   // don't let the map-click handler clear our highlight
        openDetail({ name: rt.id + " — " + rt.name, lat: pts[0][0], lng: pts[0][1],
          note: "Serves: " + (rt.serves || []).join(", ") + ".  From " + (rt.from || "?") + " to " + (rt.to || "?") + "." + (rt.length_km ? "  ~" + rt.length_km + " km." : ""),
          type: "Chapel Hill Transit route" },
          { label: rt.id, color: rt.color || "#888", icon: "bus", shape: "drop" }, "Bus line " + rt.id);
        focusRoutes([rt.id]);   // highlight in its own colour + show name (clears prior)
      });
      routePolys[rt.id] = [casing, line];
      routeIndex[rt.id] = { rt: rt, pts: pts, line: line, casing: casing };
      routePairs.push({ casing: casing, line: line });
      // NOTE: not added to the map here — bus lines are OFF by default (chip-controlled)
    });
    updateWeights();

    buildControls(amenityCounts, housingCounts, routes.routes || []);
    buildRouteChips(routes.routes || []);

    // frame the student-life envelope (destination + neighborhoods), so far
    // outliers (Southpoint, Walmart, regional route ends) don't zoom us out.
    var core = [];
    if (places.destination) core.push([places.destination.lat, places.destination.lng]);
    (housing.zones || []).forEach(function (z) { core.push([z.lat, z.lng]); });
    var fitSet = core.length >= 2 ? core : allLatLng;
    if (fitSet.length) {
      map.fitBounds(L.latLngBounds(fitSet), { padding: [70, 70], maxZoom: 15 });
    }

    document.getElementById("counts").textContent =
      (places.places || []).length + " amenities · " +
      (housing.complexes || []).length + " listings · " +
      (routes.routes || []).length + " bus lines";
  }

  // ---- layer toggle UI ---------------------------------------------
  function toggleRow(style, count, pressed) {
    var b = document.createElement("button");
    b.className = "toggle"; b.setAttribute("aria-pressed", pressed ? "true" : "false");
    b.innerHTML =
      '<span class="toggle__swatch" style="background:' + style.color + '">' +
        '<svg viewBox="0 0 24 24">' + (ICONS[style.icon] || "") + "</svg></span>" +
      '<span class="toggle__label">' + style.label + "</span>" +
      '<span class="toggle__count">' + count + "</span>";
    return b;
  }
  function groupTitle(t) {
    var d = document.createElement("div"); d.className = "layer-group__title"; d.textContent = t; return d;
  }
  function buildControls(amenityCounts, housingCounts, routeList) {
    var host = document.getElementById("layers");
    host.innerHTML = "";

    // Destination
    host.appendChild(groupTitle("destination"));
    var dRow = toggleRow({ label: "Commute destination", color: DEST_COLOR, icon: "destination" },
      DEST ? "1+" : "0", true);
    dRow.onclick = function () { toggleLayer(dRow, destLayer); };
    host.appendChild(dRow);
    var cRow = toggleRow({ label: "UNC campus outline", color: DEST_COLOR, icon: "school" }, "", true);
    cRow.onclick = function () { toggleLayer(cRow, campusLayer); };
    host.appendChild(cRow);

    // Amenities
    host.appendChild(groupTitle("amenities"));
    Object.keys(AMENITY).forEach(function (k) {
      var row = toggleRow(AMENITY[k], amenityCounts[k] || 0, AMENITY_DEFAULT[k] !== false);
      row.onclick = function () { toggleLayer(row, amenityLayers[k]); };
      host.appendChild(row);
    });

    // Housing
    host.appendChild(groupTitle("housing"));
    Object.keys(HOUSING).forEach(function (k) {
      if (!housingCounts[k]) return; // hide empty types
      var row = toggleRow(HOUSING[k], housingCounts[k], true);
      row.onclick = function () { toggleLayer(row, housingLayers[k]); };
      host.appendChild(row);
    });
    // neighborhood labels
    var zRow = toggleRow({ label: "Neighborhood labels", color: "#6b7280", icon: "landmark" }, "", true);
    zRow.onclick = function () { toggleLayer(zRow, zoneLayer); };
    host.appendChild(zRow);
  }
  function toggleLayer(btn, layer) {
    var on = btn.getAttribute("aria-pressed") === "true";
    if (on) { map.removeLayer(layer); btn.setAttribute("aria-pressed", "false"); }
    else { map.addLayer(layer); btn.setAttribute("aria-pressed", "true"); }
  }
  // ---- route chips (bus lines OFF by default; one-tap select-all/clear) -----
  function buildRouteChips(routeList) {
    var host = document.getElementById("routes");
    host.innerHTML = "";
    var chips = [];
    function setChip(c, on) {
      routePolys[c._id].forEach(function (p) { if (on) routesLayer.addLayer(p); else routesLayer.removeLayer(p); });
      c.setAttribute("aria-pressed", on ? "true" : "false");
    }
    routeList.forEach(function (rt) {
      if (!routePolys[rt.id]) return;
      var c = document.createElement("button");
      c.className = "route-chip"; c._id = rt.id; c.setAttribute("aria-pressed", "false");
      c.title = rt.name;
      c.innerHTML = '<span class="route-chip__dot" style="background:' + (rt.color || "#888") + '"></span>' +
        '<span class="route-chip__id">' + rt.id + "</span>";
      c.onclick = function () { setChip(c, c.getAttribute("aria-pressed") !== "true"); refreshAll(); };
      host.appendChild(c); chips.push(c);
    });
    var allBtn = document.getElementById("routes-toggle-all");
    function refreshAll() {
      if (!allBtn) return;
      var anyOn = chips.some(function (c) { return c.getAttribute("aria-pressed") === "true"; });
      allBtn.textContent = anyOn ? "clear" : "select all";
      allBtn.setAttribute("aria-pressed", anyOn ? "true" : "false");
    }
    if (allBtn) {
      allBtn.onclick = function () {
        var anyOn = chips.some(function (c) { return c.getAttribute("aria-pressed") === "true"; });
        chips.forEach(function (c) { setChip(c, !anyOn); });   // any on → clear all; else select all
        refreshAll();
      };
    }
    refreshAll();
  }

  // ---- panel collapse / about --------------------------------------
  var controls = document.getElementById("controls");
  var openBtn = document.getElementById("controls-open");
  document.getElementById("controls-collapse").onclick = function () {
    controls.style.display = "none"; openBtn.hidden = false;
  };
  openBtn.onclick = function () { controls.style.display = "flex"; openBtn.hidden = true; };

  var about = document.getElementById("about");
  document.getElementById("about-link").onclick = function (e) { e.preventDefault(); about.hidden = false; };
  document.getElementById("about-close").onclick = function () { about.hidden = true; };
  about.addEventListener("click", function (e) { if (e.target === about) about.hidden = true; });
})();

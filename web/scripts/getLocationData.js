const GOOGLE_API_KEY = "AIzaSyBpr3lDoX-eZ0zcNjrphmrU7BoHU6-8hz8";

document.addEventListener("DOMContentLoaded", async () => {
    // Store map objects
    let map;
    let infoWindow;

    // Store markers indexed by device identifier
    const markers = new Map();

    try {
        // Load Google Maps API
        await loadGoogleMaps();

        // Import Google Maps libraries
        const { Map, InfoWindow } = await google.maps.importLibrary("maps");

        const { AdvancedMarkerElement, PinElement } =
            await google.maps.importLibrary("marker");

        // Initialize map
        map = new Map(document.getElementById("map"), {
            zoom: 14,
            center: { lat: -37.818271, lng: 144.967062 },
        });

        infoWindow = new InfoWindow();

        // Update markers based on incoming locations
        function updateLocations(locations) {
            if (!Array.isArray(locations)) {
                console.error("Expected an array of locations");
                return;
            }

            locations.forEach((loc) => {
                if (!loc.device || !loc.location) {
                    return;
                }

                const device = String(loc.device);

                const position = {
                    lat: Number(loc.location.latitude),
                    lng: Number(loc.location.longitude),
                };

                // Validate coordinates
                if (
                    !Number.isFinite(position.lat) ||
                    !Number.isFinite(position.lng) ||
                    position.lat < -90 ||
                    position.lat > 90 ||
                    position.lng < -180 ||
                    position.lng > 180
                ) {
                    console.warn("Invalid coordinates for:", device);
                    return;
                }

                // Check if marker already exists
                let marker = markers.get(device);

                if (marker) {
                    // Move existing marker
                    marker.position = position;
                } else {
                    // Create new marker
                    const pin = new PinElement({
                        background: "#1a73e8",
                        borderColor: "#ffffff",
                        glyphColor: "#ffffff",
                    });

                    marker = new AdvancedMarkerElement({
                        map,
                        position,
                        title: device,
                        content: pin.element,
                    });

                    // Open info window when clicked
                    marker.addListener("click", () => {
                        infoWindow.setContent(
                            `<strong>${escapeHTML(device)}</strong>`,
                        );

                        infoWindow.open({
                            map,
                            anchor: marker,
                        });
                    });

                    // Store marker
                    markers.set(device, marker);
                }
            });
        }

        // Escape HTML to prevent injection
        function escapeHTML(value) {
            return value.replace(
                /[&<>"']/g,
                (char) =>
                    ({
                        "&": "&amp;",
                        "<": "&lt;",
                        ">": "&gt;",
                        '"': "&quot;",
                        "'": "&#39;",
                    })[char],
            );
        }

        // Connect to SSE endpoint
        const source = new EventSource("/api/device-locations");

        source.addEventListener("tick", (event) => {
            try {
                const data = JSON.parse(event.data);
                updateLocations(data);
            } catch (error) {
                console.error("Invalid location data:", error);
            }
        });

        source.onerror = () => {
            console.log(
                "SSE connection issue. Ready state:",
                source.readyState,
            );
        };

        // Optional: close connection when leaving page
        window.addEventListener("beforeunload", () => {
            source.close();
        });
    } catch (error) {
        console.error("Dashboard initialization failed:", error);
    }
});

// Load Google Maps JavaScript API
function loadGoogleMaps() {
    const g = {
        key: GOOGLE_API_KEY,
        v: "weekly",
    };

    const p = "The Google Maps JavaScript API";
    const c = "google";
    const l = "importLibrary";
    const q = "__ib__";
    const m = document;
    const b = window;

    let h, a, k;

    b[c] = b[c] || {};

    const d = (b[c].maps = b[c].maps || {});

    const r = new Set();
    const e = new URLSearchParams();

    const u = () =>
        h ||
        (h = new Promise(async (f, n) => {
            a = m.createElement("script");

            e.set("libraries", [...r] + "");

            for (k in g) {
                e.set(
                    k.replace(/[A-Z]/g, (t) => "_" + t[0].toLowerCase()),
                    g[k],
                );
            }

            e.set("callback", c + ".maps." + q);

            a.src = `https://maps.${c}apis.com/maps/api/js?` + e;

            d[q] = f;

            a.onerror = () => {
                h = n(Error(p + " could not load."));
            };

            a.nonce = m.querySelector("script[nonce]")?.nonce || "";

            m.head.append(a);
        }));

    if (d[l]) {
        console.warn(p + " only loads once.");
    } else {
        d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n));
    }
}

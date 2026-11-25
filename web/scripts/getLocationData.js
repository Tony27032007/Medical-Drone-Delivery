const tabSessionId = sessionStorage.getItem("mdd_tab_session");
const locationsUrl = new URL("/api/device-locations", location.origin);
if (tabSessionId) locationsUrl.searchParams.set("tab", tabSessionId);
const source = new EventSource(locationsUrl);

source.addEventListener("tick", (e) => {
    const data = JSON.parse(e.data);
    // TODO: Update dashboard with new location data
});

source.onerror = () => {
    // The browser retries automatically; close() stops it for good.
    console.log("connection lost, readyState", source.readyState);
};

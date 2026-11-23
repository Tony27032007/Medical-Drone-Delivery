const source = new EventSource("/device-locations");

source.addEventListener("tick", (e) => {
    const data = JSON.parse(e.data);
    // TODO: Update dashboard with new location data
});

source.onerror = () => {
    // The browser retries automatically; close() stops it for good.
    console.log("connection lost, readyState", source.readyState);
};

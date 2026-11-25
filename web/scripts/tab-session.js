const tabSessionId = sessionStorage.getItem("mdd_tab_session");
const requestedTabId = new URLSearchParams(location.search).get("tab");

function returnToLogin() {
    const returnTo = `${location.pathname}${location.search}`;
    location.replace(
        `/html/login.html?returnTo=${encodeURIComponent(returnTo)}`,
    );
}

if (!tabSessionId || requestedTabId !== tabSessionId) {
    returnToLogin();
} else {
    fetch("/api/auth/me", {
        headers: { "X-Tab-Session": tabSessionId },
        credentials: "same-origin",
    })
        .then((response) => {
            if (!response.ok) {
                returnToLogin();
                return;
            }
            document.documentElement.style.visibility = "";
        })
        .catch((error) => {
            console.error("Could not verify this tab's sign-in session:", error);
            returnToLogin();
        });

    document.addEventListener(
        "click",
        (event) => {
            const control = event.target.closest("a[href], button[onclick]");
            if (!control) return;

            const rawTarget = control.matches("a[href]")
                ? control.getAttribute("href")
                : control
                      .getAttribute("onclick")
                      .match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/)?.[1];
            if (!rawTarget || rawTarget.startsWith("#")) return;

            const destination = new URL(rawTarget, location.href);
            if (
                destination.origin !== location.origin ||
                !destination.pathname.startsWith("/html/")
            ) {
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();
            destination.searchParams.set("tab", tabSessionId);
            location.assign(destination);
        },
        true,
    );
}

const form = document.querySelector("#login-form");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const codeInput = document.querySelector("#verification-code");
const twoFactor = document.querySelector("#two-factor");
const enrollmentPanel = document.querySelector("#enrollment-panel");
const authenticatorKey = document.querySelector("#authenticator-key");
const authenticatorQr = document.querySelector("#authenticator-qr");
const submitButton = form.querySelector('button[type="submit"]');
const formMessage = document.querySelector("#form-message");

function getTabSessionId() {
    let tabSessionId = sessionStorage.getItem("mdd_tab_session");
    if (!tabSessionId || !/^[a-f\d]{64}$/i.test(tabSessionId)) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        tabSessionId = Array.from(bytes, (byte) =>
            byte.toString(16).padStart(2, "0"),
        ).join("");
        sessionStorage.setItem("mdd_tab_session", tabSessionId);
    }
    return tabSessionId;
}

const tabSessionId = getTabSessionId();

function showTwoFactor(setupSecret) {
    twoFactor.hidden = false;
    twoFactor.open = true;
    codeInput.disabled = false;
    codeInput.required = true;
    if (setupSecret) {
        authenticatorKey.textContent = setupSecret.secret;
        authenticatorQr.src = setupSecret.qrCodeDataUrl;
        enrollmentPanel.hidden = false;
        formMessage.textContent =
            "Set up your authenticator app, then enter its six-digit code.";
    } else {
        formMessage.textContent =
            "Enter the six-digit code from your authenticator app.";
    }
    codeInput.focus();
    submitButton.textContent = "Verify and sign in";
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formMessage.textContent = "";
    submitButton.disabled = true;

    try {
        const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
                email: emailInput.value,
                password: passwordInput.value,
                code: codeInput.value,
                tabSession: tabSessionId,
            }),
        });
        const result = await response.json();

        if (!response.ok) {
            formMessage.textContent = result.error ?? "Sign-in failed.";
            return;
        }
        if (result.twoFactorSetupRequired) {
            showTwoFactor(result);
            return;
        }
        if (result.twoFactorRequired) {
            showTwoFactor();
            return;
        }
        if (result.authenticated) {
            const requestedPath = new URLSearchParams(location.search).get(
                "returnTo",
            );
            const returnTo =
                requestedPath?.startsWith("/html/") &&
                !requestedPath.startsWith("//")
                    ? requestedPath
                    : "/html/dashboard.html";
            const destination = new URL(returnTo, location.origin);
            destination.searchParams.set("tab", tabSessionId);
            location.replace(destination);
            return;
        }
        formMessage.textContent = "Sign-in could not be completed.";
    } catch (error) {
        console.error("Sign-in request failed:", error);
        formMessage.textContent =
            "Unable to reach the sign-in service. Try again.";
    } finally {
        submitButton.disabled = false;
    }
});

fetch("/api/auth/me", {
    headers: { "X-Tab-Session": tabSessionId },
    credentials: "same-origin",
})
    .then((response) => {
        if (!response.ok) return;
        const requestedPath = new URLSearchParams(location.search).get(
            "returnTo",
        );
        const destination = new URL(
            requestedPath?.startsWith("/html/") &&
                !requestedPath.startsWith("//")
                ? requestedPath
                : "/html/dashboard.html",
            location.origin,
        );
        destination.searchParams.set("tab", tabSessionId);
        location.replace(destination);
    })
    .catch((error) => {
        console.error("Could not check the current sign-in session:", error);
    });

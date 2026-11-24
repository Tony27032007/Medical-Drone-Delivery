import "dotenv/config"; // Automatically loads .env into process.env
import { randomUUID } from "node:crypto";

// Endpoints
const API_ENDPOINT =
    "https://prod.okapi.ogw.evolve.okapi.telstra.com/mobility/products-api";
const BETA_API_ENDPOINT =
    "https://prod.okapi.ogw.evolve.okapi.telstra.com/telstradev/v1/sandbox";
const AUTH_ENDPOINT =
    "https://prod.okapi.ogw.evolve.okapi.telstra.com/og-network-auth-prod/api/realms/network-auth/protocol/openid-connect";

// Credentials
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
let ACCESS_TOKEN = null;

async function tokenAPI() {
    const url = `${AUTH_ENDPOINT}/token`;

    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
        scope: "iot-naap-loss-of-connectivity:read iot-naap-loss-of-connectivity:write location-verification:verify location-retrieval:read",
    });

    let res;

    try {
        res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        });
    } catch (error) {
        console.error("/token: Network error:", error.message);
        ACCESS_TOKEN = null;
        return null;
    }

    if (!res.ok) {
        switch (res.status) {
            case 400:
                console.log("/token: 400 Invalid client-credentials request.");
                break;
            case 401:
                console.log("/token: 401 Invalid client ID or client secret.");
                break;
            case 404:
                console.log("/token: 404 Token endpoint not found.");
                break;
            case 503:
                console.log("/token: 503 Token service unavailable.");
                break;
            default:
                console.log(`/token: ${res.status} Token service error.`);
        }

        ACCESS_TOKEN = null;
        return res;
    }

    const resBody = await res.json();
    ACCESS_TOKEN = resBody.access_token ?? null;

    return res;
}

async function subscriptionsAPI(subscriptions) {
    const url = `${API_ENDPOINT}/loss-of-connectivity/v0/subscriptions`;

    let headers = {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        Accept: "application/json",
        "Accept-Charset": "utf-8",
        "Content-Type": "application/json",
        "Content-Language": "en",
        "Correlation-Id": randomUUID(),
    };

    const body = {
        monitoringType: "LOSS_OF_CONNECTIVITY",
        subscriptions: subscriptions,
    };

    let retry = true;
    let res;

    while (retry) {
        retry = false;

        try {
            res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
            });
        } catch (error) {
            console.error("Subscription request failed:", error.message);
            return null;
        }

        const resBody = await res.json();

        switch (res.status) {
            case 201:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 201 Successful subscription.",
                );
                console.log(resBody);
                break;
            case 207:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 207 Partial success - some subscriptions failed.",
                );
                console.log(resBody.errors);

                for (const err of resBody.errors ?? []) {
                    if (err.status === 401) {
                        const res = await tokenAPI();
                        if (res !== null && res.ok) {
                            retry = true;
                            break;
                        }
                    }
                }
                break;
            case 400:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 400 Invalid request.",
                );
                console.log(resBody);
                break;
            case 401:
                const res = await tokenAPI();
                if (res !== null && res.ok) {
                    retry = true;
                    headers.Authorization = `Bearer ${ACCESS_TOKEN}`;
                    break;
                }
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 401 Unauthorized.",
                );
                console.log(resBody);
                break;
            case 403:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 403 Forbidden",
                );
                console.log(resBody);
                break;
            case 404:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 404 Not found",
                );
                console.log(resBody);
                break;
            case 500:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 500 Internal server error",
                );
                console.log(resBody);
                break;
            case 503:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 503 Service unavailable",
                );
                console.log(resBody);
                break;
            default:
                console.log(
                    `/loss-of-connectivity/v0/subscriptions: ${res.status}`,
                );
                console.log(resBody);
        }
    }

    return res;
}

async function locationRetreivalAPI(device) {
    let headers = {
        "Content-Type": "application/json",
        "X-Correlator": randomUUID(),
        Authorization: `Bearer ${ACCESS_TOKEN}`,
    };

    const body = {
        device: device,
        maxAge: 0,
    };

    let retry = true;
    let res;
    const url = BETA_API_ENDPOINT + "/location-retrieval/retrieve";
    while (retry) {
        retry = false;
        try {
            res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
            });
        } catch (error) {
            console.log("Failed to get location: ", error.message);
            return null;
        }
        const resBody = await res.json();

        switch (res.status) {
            case 400:
                console.log("/location-retrieval/retrieve: 400 Bad Request.");
                console.log(resBody);
                break;
            case 401:
                const res = await tokenAPI();
                if (res !== null && res.ok) {
                    retry = true;
                    headers.Authorization = `Bearer ${ACCESS_TOKEN}`;
                    break;
                }
                console.log("/location-retrieval/retrieve: 401 Unauthorized.");
                console.log(resBody);
                break;
            case 403:
                console.log("/location-retrieval/retrieve: 403 Forbidden.");
                console.log(resBody);
                break;
            case 404:
                console.log("/location-retrieval/retrieve: 404 Not found.");
                console.log(resBody);
                break;
            case 422:
                console.log(
                    "/location-retrieval/retrieve: 422 Unprocessable Content.",
                );
                console.log(resBody);
                break;
            default:
                console.log(`/location-retrieval/retrieve: ${res.status}.`);
                console.log(resBody);
        }
    }

    return res;
}

async function networkAvailabilityAPI(suburb, state, postcode) {
    let headers = {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Accept-Charset": "utf-8",
        Accept: "application/json",
        "Correlation-Id": randomUUID(),
        "Content-Language": "en",
        "Content-Type": "application/json",
    };
    const url =
        API_ENDPOINT +
        "/network-availability/v1/status" +
        `?suburb=${suburb}&state=${state}&postcode=${postcode}`;

    let retry = true;
    let res;
    while (retry) {
        retry = false;
        try {
            res = await fetch(url, { headers });
            const resBody = await res.json();

            switch (res.status) {
                case 400:
                    console.log(
                        "/network-availability/v1/status: 400 Invalid request or location.",
                    );
                    console.log(resBody);
                    break;
                case 401:
                    const res = await tokenAPI();
                    if (res !== null && res.ok) {
                        retry = true;
                        headers.Authorization = `Bearer ${ACCESS_TOKEN}`;
                        break;
                    }
                    console.log(
                        "/network-availability/v1/status: 401 Missing or invalid authentication token.",
                    );
                    console.log(resBody);
                    break;
                case 403:
                    console.log(
                        "/network-availability/v1/status: 403 Insufficient permissions or no active product subscription.",
                    );
                    console.log(resBody);
                    break;
                case 404:
                    console.log(
                        "/network-availability/v1/status: 404 Gateway-owned resource: resource not found.",
                    );
                    console.log(resBody);
                    break;
                case 405:
                    console.log(
                        "/network-availability/v1/status: 405 Gateway-owned resource: method not allowed.",
                    );
                    console.log(resBody);
                    break;
                case 429:
                    console.log(
                        "/network-availability/v1/status: 429 Gateway-owned resource: rate limit exceeded.",
                    );
                    console.log(resBody);
                    break;
                case 500:
                    console.log(
                        "/network-availability/v1/status: 500 An unexpected internal error or downstream timeout occured.",
                    );
                    console.log(resBody);
                    break;
                case 503:
                    console.log(
                        "/network-availability/v1/status: 503 A downstream dependency is unavailable.",
                    );
                    console.log(resBody);
                    break;
                default:
                    console.log(
                        `/network-availability/v1/status: ${res.status}.`,
                    );
                    console.log(resBody);
            }
        } catch (error) {
            console.log("Failed to get network availability: ", error.message);
        }
    }

    return res ?? null;
}

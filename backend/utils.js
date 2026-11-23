import "dotenv/config"; // Automatically loads .env into process.env
import { randomUUID } from "node:crypto";

// Endpoints
const API_ENDPOINT =
    "https://prod.okapi.ogw.evolve.okapi.telstra.com/mobility/products-api";
const AUTH_ENDPOINT =
    "https://prod.okapi.ogw.evolve.okapi.telstra.com/og-network-auth-prod/api/realms/network-auth/protocol/openid-connect";
const NOTIFICATION_DESTINATION = null;

// Credentials
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
let ACCESS_TOKEN = null;

// Devices keyed by MSISDN
const unsubbedDevices = new Map();
const subbedDevices = new Map();

class Device {
    constructor(
        msisdn = null,
        subscriptionId = null,
        notificationDestination = null,
        ipv4Address = null,
        ipv6Address = null,
        phoneNumber = null,
    ) {
        this.msisdn = msisdn;
        this.subscriptionId = subscriptionId;
        this.notificationDestination = notificationDestination;
        this.ipv4Address = ipv4Address;
        this.ipv6Address = ipv6Address;
        this.phoneNumber = phoneNumber;
    }
}

async function getToken() {
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
        return 503;
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
        return res.status;
    }

    const resBody = await res.json();
    ACCESS_TOKEN = resBody.access_token ?? null;

    return res.status;
}

async function subDevices() {
    if (ACCESS_TOKEN === null) {
        if ((await getToken()) !== 200) {
            return 401;
        }
    }

    const url = `${API_ENDPOINT}/loss-of-connectivity/v0/subscriptions`;

    const headers = {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        Accept: "application/json",
        "Accept-Charset": "utf-8",
        "Content-Type": "application/json",
        "Content-Language": "en",
        "Correlation-Id": randomUUID(),
    };

    const body = {
        monitoringType: "LOSS_OF_CONNECTIVITY",
        subscriptions: [
            {
                msisdn: [...unsubbedDevices.keys()],
                notificationDestination: NOTIFICATION_DESTINATION,
            },
        ],
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
            return 503;
        }

        let resBody;

        try {
            resBody = await res.json();
        } catch {
            resBody = {};
        }

        for (const sub of resBody.subscriptions ?? []) {
            const msisdn = sub.msisdn;

            subbedDevices.set(
                msisdn,
                new Device(
                    msisdn,
                    sub.subscriptionId,
                    sub.notificationDestination,
                ),
            );

            unsubbedDevices.delete(msisdn);
        }

        switch (res.status) {
            case 201:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 201 Successful subscription.",
                );
                console.log(resBody.errors);
                break;
            case 207:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 207 Partial success - some subscriptions failed.",
                );
                console.log(resBody.errors);

                for (const err of resBody.errors ?? []) {
                    if (err.status === 401) {
                        if ((await getToken()) === 200) {
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
                console.log(resBody.errors);
                break;
            case 401:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 401 Unauthorized.",
                );
                console.log(resBody.errors);

                if ((await getToken()) === 200) {
                    retry = true;
                }

                break;
            case 403:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 403 Forbidden",
                );
                console.log(resBody.errors);
                break;
            case 404:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 404 Not found",
                );
                console.log(resBody.errors);
                break;
            case 500:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 500 Internal server error",
                );
                console.log(resBody.errors);
                break;
            case 503:
                console.log(
                    "/loss-of-connectivity/v0/subscriptions: 503 Service unavailable",
                );
                console.log(resBody.errors);
                break;
            default:
                console.log(
                    `/loss-of-connectivity/v0/subscriptions: ${res.status}`,
                );
                console.log(resBody.errors);
        }
    }

    return res.status;
}

function dispatchDrone() {
    // TODO: Implement drone dispatch logic
}

export function GetDashboardData(req, res) {
    const header = {
        "Content-Type": "application/json",
        "X-Correlator": randomUUID(),
    };

    const body = {
        device: "",
        maxAge: "b",
        maxSurface: "a",
    };
    // Map + location
    // Connection status
    // Dispatch status
    // Task: destination, starting, payload
}

export function NotificationHandler(req, res) {
    // Accept notification
    res.writeHead(202);
    res.end();

    // Process notificaiton
    const lossOfConnectReason = {
        UE_DETACHED_MME: 0,
        UE_DETACHED_SGSN: 1,
        MAX_DETECTION_TIME_EXPIRED_MME: 2,
        MAX_DETECTION_TIME_EXPIRED_SGSN: 3,
        UE_PURGED_MME: 4,
        UE_PURGED_SGSN: 5,
        DEREGISTERED_AMF: 6,
        MAX_DETECTION_TIME_EXPIRED_AMF: 7,
        PURGED_AMF: 8,
    };

    let body = "";
    req.on("data", (chunk) => {
        body += chunk;
    });
    body = json.JSON(body);

    // Send notification to dashboard
    // TODO: Connect with frontend

    // Handle loss of connection reason
    switch (body.monitoringEventReports.lossOfConnectReason) {
        case lossOfConnectReason.UE_DETACHED_MME:
        case lossOfConnectReason.UE_DETACHED_SGSN:
        case lossOfConnectReason.DEREGISTERED_AMF:
            // Handle detached/deregistration
            break;
        case lossOfConnectReason.MAX_DETECTION_TIME_EXPIRED_MME:
        case lossOfConnectReason.MAX_DETECTION_TIME_EXPIRED_SGSN:
        case lossOfConnectReason.MAX_DETECTION_TIME_EXPIRED_AMF:
            // Check network availability or error
            break;
        case lossOfConnectReason.UE_PURGED_MME:
        case lossOfConnectReason.UE_PURGED_SGSN:
        case lossOfConnectReason.PURGED_AMF:
            // Handle purged registration
            break;
    }
}

import { IncomingMessage, ServerResponse } from "node:http";
import {
    SubscriptionsAPI,
    LocationRetreivalAPI,
    NetworkAvailabilityAPI,
    GetAddressAPI,
} from "./externalApis.js";

// API Handler
export async function HandleAPIs(req, res, url) {
    const routes = {
        "/api/device-locations": GetLocationData,
        "/api/notification-destination": NotificationHandler,
    };
    const handler = routes[url];
    await handler(req, res);
}

const NOTIFICATION_DESTINATION = null;

// Devices keyed by MSISDN
const devices = new Map();

class Device {
    constructor(
        msisdn = null,
        subscriptionId = null,
        notificationDestination = null,
        ipv4Address = null,
        ipv6Address = null,
        phoneNumber = null,
        latitude = null,
        longitude = null,
    ) {
        this.msisdn = msisdn;
        this.subscriptionId = subscriptionId;
        this.notificationDestination = notificationDestination;
        this.ipv4Address = ipv4Address;
        this.ipv6Address = ipv6Address;
        this.phoneNumber = phoneNumber;
        this.latitude = latitude;
        this.longitude = longitude;
    }
}

async function subDevices() {
    const res =
        (await SubscriptionsAPI([
            {
                msisdn: [...devices.entries()]
                    .filter(([_, device]) => device.subscriptionId !== null)
                    .map(([key]) => key),
                notificationDestination: NOTIFICATION_DESTINATION,
            },
        ])) ?? null;

    if (res !== null) {
        const resBody = await res.json();

        for (const sub of resBody.subscriptions ?? []) {
            devices[sub.msisdn].subscriptionId = sub.subscriptionId;
            devices[sub.msisdn].notificationDestination =
                sub.notificationDestination;
        }

        return res.status;
    }

    return null;
}

function dispatchDrone() {
    // TODO: Implement drone dispatch logic
}

// Handler for the route: /device-locations
// Sends device locations to clients using Server-Sent Events.

/**
 * @param { import("node:http").IncomingMessage } req
 * @param { import("node:http").ServerResponse } res
 */
export function GetLocationData(req, res) {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
    });

    let closed = false;
    let timeout;

    // Detect client disconnection
    res.on("close", () => {
        closed = true;
        clearTimeout(timeout);
    });

    async function poll() {
        if (closed) return;

        try {
            // Retrieve locations for all registered devices
            const devLocations = await Promise.all(
                Array.from(devices, async ([msisdn, dev]) => {
                    try {
                        const apiRes = await LocationRetreivalAPI({
                            ipv4Address: dev.ipv4Address,
                        });

                        if (!apiRes?.ok) return null;

                        const resBody = await apiRes.json();

                        const latitude = resBody?.area?.center?.latitude;
                        const longitude = resBody?.area?.center?.longitude;

                        if (
                            latitude == null ||
                            longitude == null ||
                            !Number.isFinite(Number(latitude)) ||
                            !Number.isFinite(Number(longitude))
                        ) {
                            return null;
                        }

                        return {
                            device: msisdn,
                            location: {
                                latitude: Number(latitude),
                                longitude: Number(longitude),
                            },
                        };
                    } catch (error) {
                        console.error(
                            `Location retrieval failed for ${msisdn}:`,
                            error.message,
                        );

                        return null;
                    }
                }),
            );

            const validLocations = devLocations.filter(
                (location) => location !== null,
            );

            // Send SSE event
            if (!closed && !res.destroyed) {
                res.write(
                    `event: tick\n` +
                        `data: ${JSON.stringify(validLocations)}\n\n`,
                );
            }
        } catch (error) {
            console.error("SSE polling error:", error.message);
        }

        // Schedule next poll
        if (!closed && !res.destroyed) {
            timeout = setTimeout(poll, 5000);
        }
    }

    // Start polling
    poll();
}

// Handler for the route: /notification-destination
/**
 * @param { IncomingMessage } req
 * @param { ServerResponse } res
 */
export async function NotificationHandler(req, res) {
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

    let rawBody = "";
    for await (const chunk of req) {
        rawBody += chunk;
    }
    const body = JSON.parse(rawBody) ?? null;
    if (body === null) {
        return;
    }

    // Send notification to dashboard
    // TODO: Connect with frontend

    // Handle loss of connection reason
    const locationAvailability = new Map();
    for (const report of body.monitoringEventReports) {
        let netAvailable = false;

        // Get location via a reverse geocoding API
        const dev = devices.get(report.msisdn);
        const address = await GetAddressAPI(dev.latitude, dev.longitude);
        const suburb = address.suburb;
        const state = address.state;
        const postcode = address.postcode;
        const key = `${suburb}|${state}|${postcode}`;

        // Check if network is down at location
        if (locationAvailability.has(key)) {
            if (locationAvailability.get(key)) {
                netAvailable = true;
            }
        } else {
            const res =
                (await NetworkAvailabilityAPI(suburb, state, postcode)) ?? null;
            if (res !== null) {
                const resBody = await res.json();
                if (res.ok && !resBody.current) {
                    netAvailable = true;
                }
                locationAvailability.set(key, netAvailable);
            }
        }

        // Handle loss of connection
        switch (report.lossOfConnectReason) {
            case lossOfConnectReason.UE_DETACHED_MME:
            case lossOfConnectReason.UE_DETACHED_SGSN:
            case lossOfConnectReason.DEREGISTERED_AMF:
                // Handle detached/deregistration
                break;
            case lossOfConnectReason.MAX_DETECTION_TIME_EXPIRED_MME:
            case lossOfConnectReason.MAX_DETECTION_TIME_EXPIRED_SGSN:
            case lossOfConnectReason.MAX_DETECTION_TIME_EXPIRED_AMF:
                // Handle connectivity timeout
                break;
            case lossOfConnectReason.UE_PURGED_MME:
            case lossOfConnectReason.UE_PURGED_SGSN:
            case lossOfConnectReason.PURGED_AMF:
                // Handle purged registration
                break;
        }
    }
}

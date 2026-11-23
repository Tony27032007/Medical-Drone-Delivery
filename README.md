# Medical Drone Delivery

Medical Drone Delivery is a system-architecture prototype for monitoring and coordinating simulated drone deliveries of medical supplies. It separates client-facing operations, delivery ingestion, decision-making, approvals, notifications, and external resilience services.

## Architecture

![PNG](/Medical_Drone_Delivery_System_Architecture.png)

## Components

### Operations dashboard

Provides operators with live delivery and system status updates. It receives information through the API Gateway and presents actions and incidents for review.

### Drone fleet simulator

Represents connected medical delivery drones. It sends telemetry, such as position and flight status, to the API Gateway for routing into the core services.

### Admin approval UI

Allows administrators to approve or reject operational actions proposed by the system.

### API Gateway and ingest

Acts as the entry point for dashboard updates, drone telemetry, and approval requests. It routes validated events to the appropriate core service.

### Decision Engine

Classifies the root cause of an issue and determines whether a corrective action is required. It can consult external health and location APIs when additional context is needed:

- **IoT Loss of Connectivity API:** checks whether a drone or device is offline.
- **Network Availability API:** evaluates network outages.
- **Location Retrieval API:** obtains the current or last known location.
- **Location Verification API:** verifies whether a drone is on site.

### AI Agent

Assists the decision flow by reasoning about an incident and recording why a conclusion or recommendation was produced. The agent writes event records and its reasoning context to the database.

### Action Orchestrator

Turns an approved decision into operational work, such as dispatching a response or activating failover. It notifies alerting services and can route operations through the satellite failover service.

### Satellite failover

Provides a failover communication path when primary network connectivity is unavailable.

### Notifications

Delivers alerts and status changes to operators and other relevant users.

### Database

Stores decisions, events, reasoning, delivery state, and operational audit records.

## Event Flow

1. The simulated drone fleet sends telemetry to the API Gateway.
2. The gateway routes telemetry to the Decision Engine.
3. The engine classifies the root cause and requests supporting data from external APIs when needed.
4. The AI Agent reasons about the situation and records the event and rationale.
5. The Decision Engine proposes an action.
6. Administrators approve or reject the action through the approval UI.
7. The Action Orchestrator dispatches an approved action.
8. The orchestrator sends alerts, activates failover when necessary, and records decisions and outcomes.
9. The operations dashboard receives live updates.

## Repository Structure

```text
Medical Drone Delivery/
├── README.md
├── Medical_Drone_Delivery_System_Architecture.png
└── web/
      └── html/
      └── css/
      └── javascript/
      └── resource/
      └── user/
```

## Getting Started

The repository currently contains a static HTML entry point. From the project directory, open the page directly:

```bash
open web/html/home.html
```

Or serve the project with a local static server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/web/html/home.html`.

## Suggested Implementation Roadmap

- Add the operations dashboard and responsive data views.
- Implement a simulated drone fleet with configurable telemetry.
- Create API routes for telemetry, approvals, decisions, alerts, and drone status.
- Add authentication and role-based access for operators and administrators.
- Integrate persistent storage for deliveries, events, decisions, and audit logs.
- Add network, location, and connectivity adapters behind stable service interfaces.
- Implement satellite failover and retry policies.
- Add real-time updates with WebSockets or server-sent events.
- Define tests for decision classification, approval workflows, failover behavior, and telemetry ingestion.

## Design Considerations

- **Safety:** Critical dispatch actions should require explicit approval and enforce authorization checks.
- **Auditability:** Preserve decision inputs, AI reasoning summaries, approval identities, and timestamps.
- **Resilience:** Degrade gracefully when network, location, or device APIs are unavailable.
- **Observability:** Correlate telemetry, decisions, events, notifications, and actions using a delivery or incident ID.
- **Data minimization:** Restrict sensitive patient and delivery information to services that require it.
- **Testability:** Keep external APIs and drone devices behind interfaces so the system can be simulated locally.

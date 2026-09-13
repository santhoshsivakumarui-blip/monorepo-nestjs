describe("deployment proof gate", () => {
  const { validateDeploymentProof } = require("./check-deployment-proof.js");

  it("requires a managed deployment, real endpoint URLs, and observability ownership", () => {
    const result = validateDeploymentProof({
      NODE_ENV: "production",
      MANAGED_ENVIRONMENT: "",
      MANAGED_CLUSTER: "",
      DEPLOYMENT_NAMESPACE: "",
      INGRESS_HOST: "",
      GATEWAY_URL: "http://internal-host",
      SERVICE_ROUTE: "users",
      BROKER_TOPIC: "",
      CONSUMER_GROUP: "",
      METRICS_ENDPOINT: "bad-url",
      TRACE_ENDPOINT: "",
      OBSERVABILITY_OWNER: "",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "MANAGED_ENVIRONMENT",
        "MANAGED_CLUSTER",
        "DEPLOYMENT_NAMESPACE",
        "INGRESS_HOST",
        "BROKER_TOPIC",
        "CONSUMER_GROUP",
        "GATEWAY_URL",
        "SERVICE_ROUTE",
        "METRICS_ENDPOINT",
        "TRACE_ENDPOINT",
        "OBSERVABILITY_OWNER",
      ]),
    );
  });

  it("accepts a complete managed-production deployment proof configuration", () => {
    const result = validateDeploymentProof({
      NODE_ENV: "production",
      MANAGED_ENVIRONMENT: "azure",
      MANAGED_CLUSTER: "aks-prod-westus",
      DEPLOYMENT_NAMESPACE: "platform-prod",
      INGRESS_HOST: "api.example.com",
      GATEWAY_URL: "https://api.example.com",
      SERVICE_ROUTE: "/api/users/users",
      BROKER_TOPIC: "users.created.v1",
      CONSUMER_GROUP: "users-consumers",
      METRICS_ENDPOINT: "https://prometheus.example.com/api/v1/query",
      TRACE_ENDPOINT: "https://tempo.example.com/api/traces",
      OBSERVABILITY_OWNER: "platform-sre",
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

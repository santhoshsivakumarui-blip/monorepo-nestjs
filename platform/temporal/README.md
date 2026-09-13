# Temporal integration

Use Temporal for long-running, compensating workflows such as payment capture, order fulfilment, onboarding, and webhook retries. Keep the workflow state out of request handlers; a request starts a workflow and returns its ID.

For local development, run Temporal's official development server or add its official Compose setup. Production should use Temporal Cloud or the official Helm chart with a separately managed persistence database.

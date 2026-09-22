# Billing service

This service owns its own domain data, REST contracts, and event streams.

## Expected layout

- src/config
- src/modules/billing
- src/guards
- src/filters
- src/interceptors
- test/e2e

Register the service in nest-cli.json, Docker Compose, k8s, and Helm after defining the domain contract.

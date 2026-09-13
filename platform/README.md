# Optional platform services

Start the local identity/authorization/API-edge and cloud emulators with:

```sh
docker compose --profile platform up --build
```

Endpoints: Kong proxy `:8000`, Kong Admin `:8001`, Keycloak `:8080`, OpenFGA `:8081`, Mailpit UI `:8025`, LocalStack `:4566`.

The included Keycloak credentials are local-development only. Import `openfga/model.fga` through the OpenFGA API before enabling relationship checks. Temporal and Unleash are intentionally documented deployment integrations: their production persistence and credentials must be selected by the environment owner.

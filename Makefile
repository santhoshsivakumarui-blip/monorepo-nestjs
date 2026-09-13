.PHONY: bootstrap up down verify test load deploy
bootstrap:
	npm ci
	git config core.hooksPath .githooks
up:
	docker compose up --build
down:
	docker compose down
verify:
	npm run check:architecture && npm run build && npm test -- --runInBand && kubectl kustomize k8s > /dev/null
test:
	npm test -- --runInBand
load:
	k6 run load/k6-gateway.js
deploy:
	helm upgrade --install platform helm/platform

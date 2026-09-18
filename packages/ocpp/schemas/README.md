# Vendored OCPP schemas

The JSON collections are copied byte-for-byte from `ocpp-rpc@2.2.1`:

- `1.6/schemas.json`: `lib/schemas/ocpp1_6.json`
- `2.0.1/schemas.json`: `lib/schemas/ocpp2_0_1.json`

Source: https://github.com/mikuso/ocpp-rpc

The package's MIT notice is preserved in `LICENSE.ocpp-rpc.md`. The upstream
project clarifies that the OCPP schemas originate from the Open Charge Alliance
and are licensed under CC BY-ND 4.0, independently of the library's MIT license:
https://github.com/mikuso/ocpp-rpc#license
https://creativecommons.org/licenses/by-nd/4.0/

Attribution: Open Charge Alliance, OCPP 1.6 and OCPP 2.0.1 JSON schemas,
distributed in ocpp-rpc (copyright Gareth Hughes). ChargeMesh has not modified these files.
These collections use JSON Schema draft-07 and IDs of the form
`urn:Action.req` / `urn:Action.conf`, as shipped by ocpp-rpc.

Reproduce with `pnpm --filter @chargemesh/ocpp vendor:schemas`. The pinned
development dependency and lockfile retain the source version and integrity.

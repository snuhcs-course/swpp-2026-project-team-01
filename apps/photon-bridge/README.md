# Former Photon bridge

The bridge source, tests and package manifests were removed on 2026-10-07. This directory is not runnable. The rebuild first verifies eve's native Photon channel; a new standalone bridge is conditional on that integration result.

The previous Fly service was not stopped or deleted. Identify and fence old consumers before testing replacement channel delivery. Historical [Fly/container configuration](../../documentations/archive/2026-10-07-photon-bridge/README.md), [deployment evidence](../../scripts/p0/fly-bridge-live-results-2026-10-05.json) and the [source-removal checkpoint](../../documentations/archive/2026-10-07-source-removal.md) preserve the baseline. See [provider setup](../../documentations/technical_specification/03_provider_setup.md) for the replacement direction.

# Spec Delta

## ADDED Requirements

### Requirement: Reviewed screenshot availability
The service SHALL let a guest offer a calendar screenshot as an optional source of availability for their own request. The service SHALL accept only supported image files within the published limit, SHALL scope processing to the current request, and SHALL present any inferred time windows with their dates, timezone and interpretation for explicit guest correction and confirmation. Missing dates, timezone or unclear busy-versus-free meaning SHALL require clarification. Neither the upload nor an inference alone SHALL change saved availability, trigger candidate evaluation, or authorize a proposal. Once confirmed, the resulting windows SHALL follow the same validation, expected-revision and privacy rules as manually entered availability. The original image and extracted event contents SHALL not appear in host, agent or conversation projections, logs or durable request history.

#### Scenario: Guest confirms extracted windows
- **WHEN** a supported image yields unambiguous draft windows and the guest corrects or confirms them
- **THEN** only the confirmed windows are saved to that request under its current revision and can be used by evaluation

#### Scenario: Ambiguous screenshot
- **WHEN** an image lacks a date or timezone, or its marks cannot be identified as busy or free
- **THEN** no availability is saved from it and the guest is asked for the missing meaning or offered manual entry

#### Scenario: Unsupported or oversized image
- **WHEN** a guest selects a file outside the supported image types or size limit
- **THEN** it is rejected before extraction with a readable reason, and existing request details remain unchanged

#### Scenario: Private image contents
- **WHEN** a host or an agent reads the request after a guest uploads a screenshot
- **THEN** the image and its unconfirmed or private extracted contents are absent from their projections

#### Scenario: OCR suggests visible free time
- **WHEN** a configured extractor finds clear free ranges in a day or week screenshot
- **THEN** those ranges are preselected only in the guest's editable review, and no availability is saved until the guest confirms them

#### Scenario: OCR is unavailable or the request reaches its budget
- **WHEN** extraction is disabled, the provider fails, or five attempts have been reserved for the request
- **THEN** no image-derived availability is saved and the guest can enter free times manually

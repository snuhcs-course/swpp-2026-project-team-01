# Spec Delta

## ADDED Requirements

### Requirement: Host schedule image review
The host Calendar connection card SHALL offer an English action to upload a schedule image. Activating it SHALL reveal a PNG/JPEG/WebP file input, preview, reading status and detected free hours. The server SHALL authorize the host, bound and validate the image, limit model attempts and return only structured weekday/time ranges. Adding the detected hours to setup SHALL create an unaccepted draft suggestion. After Google Calendar connection, the normal weekly hours question SHALL show that suggestion with actions to accept or adjust it. The image and private extracted text SHALL not be persisted or sent to a guest or the assistant. The host SHALL still choose a writable Google Calendar destination for confirmed bookings.

#### Scenario: Recognized weekly timetable
- **WHEN** the host uploads a labeled weekly timetable and the extractor finds clear free hours
- **THEN** the hours appear as a draft suggestion and the weekly hours question asks the host to accept or correct them

#### Scenario: Unavailable reading
- **WHEN** the image is invalid, ambiguous, the provider is disabled or a budget limit is reached
- **THEN** the host can enter weekly hours through the existing setup editor and still connect Calendar for bookings

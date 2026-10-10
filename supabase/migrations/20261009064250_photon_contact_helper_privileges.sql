SET local check_function_bodies = off;

REVOKE ALL ON FUNCTION "fmat"."photon_contact_authorized"(fmat.photon_contact_shares) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."photon_contact_view"(fmat.photon_contact_shares) FROM PUBLIC;

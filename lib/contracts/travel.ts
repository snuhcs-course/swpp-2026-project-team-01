import {Temporal} from '@js-temporal/polyfill';
import {z} from 'zod';
export const travelInstant=z.iso.datetime({offset:true}).refine(value=>{try{Temporal.Instant.from(value);return true;}catch{return false;}});
export const routeLocation=z.union([
 z.strictObject({address:z.string().trim().min(1).max(2000)}),
 z.strictObject({placeId:z.string().trim().min(1).max(300)}),
 z.strictObject({latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180)}),
]);
export const routeMode=z.enum(['DRIVE','TRANSIT','WALK','BICYCLE']);
export const routeRequest=z.strictObject({origin:routeLocation,destination:routeLocation,mode:routeMode,departureTime:travelInstant});
export type RouteRequest=z.infer<typeof routeRequest>;
export type RouteLocation=z.infer<typeof routeLocation>;
export type RouteResult=
 |{status:'success';fingerprint:string;checkedAt:string;departureTime:string;durationNanoseconds:string;distanceMeters:number|null}
 |{status:'no_route';fingerprint:string;checkedAt:string}
 |{status:'unsupported';reason:'mode'|'departure_context'|'location'|'provider_fallback';fingerprint:string|null;checkedAt:string}
 |{status:'failure';reason:'invalid_input'|'configuration'|'denied'|'rate_limit'|'deadline'|'unavailable'|'malformed';fingerprint:string|null;checkedAt:string};

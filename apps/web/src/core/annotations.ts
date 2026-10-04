import type {CalendarSourceInput} from './calendar'
export interface AnnotationProjection {field_fingerprints_json:string;values_json:string;revision:number}
export function projectAnnotation(sourceFields:string,annotation?:AnnotationProjection|null):CalendarSourceInput {
 const fields=JSON.parse(sourceFields),source=structuredClone(fields.source) as CalendarSourceInput
 if(!annotation)return source
 const saved=JSON.parse(annotation.field_fingerprints_json),values=JSON.parse(annotation.values_json)
 if(saved.location===fields.location && values.locationKind)source.confirmedLocation={kind:values.locationKind,placeRef:values.placeRef??null}
 if(saved.classification===fields.classification && values.classification)source.userClassification=values.classification
 return source
}

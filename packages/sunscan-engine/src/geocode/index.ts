// Geocoding public API (contracts.ts): geocodeUk, suggestUk, parseUkAddress, nationAt.
export { geocodeUk, type GeocodeOptions } from './geocode.js';
export { suggestUk, nationAt } from './suggest.js';
export {
  parseUkAddress, parseUkAddressDetailed, normalisePostcode, extractPostcode, isPostcodePrefix, nationFromPostcodeArea,
  expandStreetAbbrev, POSTCODE_RE, type ParsedAddressDetail, type FoundPostcode,
} from './address.js';
export { nameSimilar, sameHouseNumber, postcodeRelation, isNonHouse, normText } from './candidates.js';
export {
  nationFromCountry, haversineM, viewboxAround, nominatimSearchUrl, photonUrl, postcodesIo,
  NOMINATIM, POSTCODES_IO, PHOTON, UK_BBOX,
} from './clients.js';

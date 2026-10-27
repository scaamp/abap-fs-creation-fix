import { XMLParser, XMLValidator } from "fast-xml-parser"

export type XmlNode = Record<string, unknown>
export const node = (value: unknown): XmlNode =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as XmlNode) : {}
export const nodes = (value: unknown): XmlNode[] =>
  (value === undefined ? [] : Array.isArray(value) ? value : [value]).map(node)
export const attribute = (value: unknown, name: string) => {
  const field = node(value)[`@_${name}`]
  return typeof field === "string" ? field : ""
}
export class ODataReadError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}
export function reject(code: string, message: string): never {
  throw new ODataReadError(code, message)
}

// Odczyt pojedynczego dokumentu; nie pobieraj zewnętrznych encji ani referencji schematów.
export function xml(body: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(body))
    reject("UNSUPPORTED_XML", "External entities and DTD are not accepted")
  if (XMLValidator.validate(body) !== true) reject("INVALID_XML", "Expected well-formed XML")
  try {
    return node(
      new XMLParser({
        ignoreAttributes: false,
        removeNSPrefix: true,
        parseAttributeValue: false
      }).parse(body)
    )
  } catch {
    return reject("INVALID_XML", "Expected a valid XML metadata document")
  }
}
export interface Property {
  name: string
  type: string
  nullable: boolean
}
export interface Navigation {
  name: string
  type: string
  collection: boolean
}
export interface EntityType {
  name: string
  keys: string[]
  properties: Property[]
  navigations: Navigation[]
}
export interface EntitySet {
  name: string
  type: string
}
export interface ODataModel {
  version: string
  entitySets: EntitySet[]
  types: Map<string, EntityType>
  externalReferenceCount: number
}

export function readModel(body: string): ODataModel {
  const edmx = node(xml(body).Edmx)
  const version = attribute(edmx, "Version")
  if (!/^4\.(0|01)$/.test(version))
    reject("UNSUPPORTED_ODATA_VERSION", "This preview supports OData V4 XML CSDL only")
  const schemas = nodes(node(edmx.DataServices).Schema)
  const aliases = new Map(
    schemas.map(schema => [attribute(schema, "Alias"), attribute(schema, "Namespace")])
  )
  const qualify = (name: string) => {
    const dot = name.indexOf(".")
    const alias = aliases.get(name.slice(0, dot))
    return dot >= 0 && alias ? alias + name.slice(dot) : name
  }
  const raw = new Map<string, XmlNode>()
  for (const schema of schemas)
    for (const type of nodes(schema.EntityType))
      raw.set(`${attribute(schema, "Namespace")}.${attribute(type, "Name")}`, type)
  const types = new Map<string, EntityType>()
  const resolve = (name: string, seen: string[] = []): EntityType => {
    const existing = types.get(name)
    if (existing) return existing
    if (seen.includes(name) || seen.length >= 16)
      reject("INVALID_MODEL", "Cyclic or excessively deep entity inheritance")
    const type = raw.get(name)
    if (!type)
      return reject("UNRESOLVED_TYPE", "An entity type requires an unsupported external schema")
    const baseName = qualify(attribute(type, "BaseType"))
    const base = baseName ? resolve(baseName, [...seen, name]) : undefined
    const keys = nodes(node(type.Key).PropertyRef).map(key => attribute(key, "Name"))
    const properties = nodes(type.Property).map(property => ({
      name: attribute(property, "Name"),
      type: attribute(property, "Type"),
      nullable: attribute(property, "Nullable") !== "false"
    }))
    const navigations = nodes(type.NavigationProperty).map(navigation => {
      const target = attribute(navigation, "Type")
      return {
        name: attribute(navigation, "Name"),
        type: qualify(target.replace(/^Collection\((.*)\)$/, "$1")),
        collection: target.startsWith("Collection(")
      }
    })
    const result: EntityType = {
      name,
      keys: keys.length ? keys : base?.keys || [],
      properties: [...(base?.properties || []), ...properties],
      navigations: [...(base?.navigations || []), ...navigations]
    }
    types.set(name, result)
    return result
  }
  for (const name of raw.keys()) resolve(name)
  const entitySets = schemas.flatMap(schema =>
    nodes(schema.EntityContainer).flatMap(container =>
      nodes(container.EntitySet).map(set => ({
        name: attribute(set, "Name"),
        type: qualify(attribute(set, "EntityType"))
      }))
    )
  )
  if (!entitySets.length) reject("NO_ENTITY_SETS", "Metadata contains no entity sets")
  if (new Set(entitySets.map(set => set.name)).size !== entitySets.length)
    reject("INVALID_MODEL", "Ambiguous entity set names")
  return { version, entitySets, types, externalReferenceCount: nodes(edmx.Reference).length }
}

export interface ExpandInput {
  navigation: string
  select: string[]
  top?: number
}
export interface ReadQuery {
  entitySet: string
  select: string[]
  top?: number
  expand?: ExpandInput[]
}
export interface Projection {
  type: EntityType
  properties: Property[]
  top: number
}
export interface QueryPlan extends Projection {
  entitySet: string
  expand: (Projection & { name: string; collection: boolean })[]
  query: Record<string, string | number>
}

function limit(value: number | undefined, fallback: number, max: number) {
  const result = value === undefined ? fallback : value
  if (!Number.isInteger(result) || result < 1 || result > max)
    reject("INVALID_LIMIT", `Use an integer limit between 1 and ${max}`)
  return result
}
function selection(type: EntityType, fields: string[]) {
  if (
    !Array.isArray(fields) ||
    !fields.length ||
    fields.length > 20 ||
    new Set(fields).size !== fields.length
  )
    return reject("INVALID_SELECT", "Select 1 to 20 distinct structural properties")
  return fields.map(name => {
    if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z\d_]*$/.test(name))
      reject("INVALID_SELECT", "Use simple declared property names")
    const property = type.properties.find(property => property.name === name)
    if (!property)
      return reject("UNKNOWN_PROPERTY", "A selected property is not declared in this entity type")
    if (!property.type.startsWith("Edm.") || ["Edm.Stream", "Edm.Binary"].includes(property.type))
      reject("UNSUPPORTED_PROPERTY", "This preview reads scalar non-stream properties only")
    return property
  })
}
export function planQuery(model: ODataModel, input: ReadQuery): QueryPlan {
  const set = model.entitySets.find(set => set.name === input.entitySet)
  if (!set) return reject("UNKNOWN_ENTITY_SET", "Choose an entity set returned by get_metadata")
  if (!/^[A-Za-z_][A-Za-z\d_]*$/.test(set.name))
    reject("UNSUPPORTED_NAME", "This preview requires simple entity set names")
  const type = model.types.get(set.type)
  if (!type)
    return reject("UNRESOLVED_TYPE", "The selected entity type is not in this metadata document")
  const properties = selection(type, input.select)
  const top = limit(input.top, 5, 20)
  if (input.expand !== undefined && (!Array.isArray(input.expand) || input.expand.length > 2))
    reject("INVALID_EXPAND", "Expand at most two direct navigations")
  const expanded = new Set<string>()
  const expand = (input.expand || []).map(item => {
    const navigation = type.navigations.find(nav => nav.name === item.navigation)
    if (!navigation || expanded.has(item.navigation))
      return reject("INVALID_EXPAND", "Choose distinct declared direct navigations")
    if (!/^[A-Za-z_][A-Za-z\d_]*$/.test(navigation.name))
      reject("INVALID_EXPAND", "Use simple direct navigation names")
    expanded.add(item.navigation)
    const target = model.types.get(navigation.type)
    if (!target) return reject("UNRESOLVED_TYPE", "Navigation requires an external entity schema")
    if (!navigation.collection && item.top !== undefined)
      reject("INVALID_LIMIT", "A single-valued navigation has no top option")
    return {
      name: navigation.name,
      type: target,
      collection: navigation.collection,
      properties: selection(target, item.select),
      top: navigation.collection ? limit(item.top, 1, 5) : 1
    }
  })
  const query: Record<string, string | number> = {
    $top: top,
    $select: properties.map(property => property.name).join(",")
  }
  if (expand.length)
    query.$expand = expand
      .map(
        item =>
          `${item.name}($select=${item.properties.map(property => property.name).join(",")}${item.collection ? `;$top=${item.top}` : ""})`
      )
      .join(",")
  return { entitySet: set.name, type, properties, top, expand, query }
}

// Zwracaj wyłącznie wybrane pola, bez niezamówionych adnotacji/URL. Nie zaokrąglaj kwot ani Int64.
export function projectRows(value: unknown, plan: QueryPlan) {
  const root = node(value)
  if (!Array.isArray(root.value)) reject("INVALID_RESPONSE", "Expected an OData V4 collection")
  const rows = root.value as unknown[]
  const project = (source: unknown, properties: Property[]) => {
    if (!source || typeof source !== "object" || Array.isArray(source))
      return reject("INVALID_RESPONSE", "Expected an entity object")
    const record = node(source)
    return Object.fromEntries(
      properties.map(property => {
        if (!Object.hasOwn(record, property.name))
          reject("MISSING_SELECTED_PROPERTY", "Response omitted a selected property")
        const item = record[property.name]
        if (item !== null && !["string", "number", "boolean"].includes(typeof item))
          reject("INVALID_RESPONSE", "Expected a scalar selected property")
        if (typeof item === "number" && !Number.isFinite(item))
          reject("UNSAFE_NUMBER", "Expected a finite numeric value")
        if (
          ["Edm.Decimal", "Edm.Int64"].includes(property.type) &&
          item !== null &&
          typeof item !== "string"
        )
          reject(
            "UNSAFE_NUMBER",
            "Server did not return Decimal/Int64 as strings with IEEE754Compatible=true"
          )
        return [property.name, item]
      })
    )
  }
  if (rows.length > plan.top)
    reject("SERVER_LIMIT_NOT_HONORED", "Server exceeded the requested row limit")
  const data = rows.map(source => {
    const result = project(source, plan.properties)
    for (const expand of plan.expand) {
      const item = node(source)[expand.name]
      if (expand.collection) {
        if (!Array.isArray(item))
          reject("INVALID_RESPONSE", "Expanded collection missing from response")
        const items = item as unknown[]
        if (items.length > expand.top)
          reject("SERVER_LIMIT_NOT_HONORED", "Server exceeded the expanded row limit")
        result[expand.name] = items.map(child => project(child, expand.properties))
      } else result[expand.name] = item === null ? null : project(item, expand.properties)
    }
    return result
  })
  return {
    rows: data,
    hasMore: typeof root["@odata.nextLink"] === "string",
    expandedHasMore: plan.expand
      .filter(expand =>
        rows.some(row => typeof node(row)[`${expand.name}@odata.nextLink`] === "string")
      )
      .map(expand => expand.name)
  }
}

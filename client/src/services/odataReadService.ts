import { createHash, randomUUID } from "crypto"
import type { HttpClientResponse } from "abap-adt-api/build/AdtHTTP"
import {
  ODataReadError,
  attribute,
  node,
  nodes,
  planQuery,
  projectRows,
  readModel,
  reject,
  xml,
  type ReadQuery
} from "./odataModel"

export interface ODataGetOptions {
  method: "GET"
  headers: Record<string, string>
  qs: Record<string, string | number>
  timeout: number
  maxRedirects: number
  maxContentLength: number
}
export interface ODataConnection {
  identity: object
  baseUrl: string
  sapClient: string
  request(path: string, options: ODataGetOptions): Promise<HttpClientResponse>
}
export interface ODataDependencies {
  connection(id: string): ODataConnection | Promise<ODataConnection>
  now?: () => number
}
export interface ResolveODataInput {
  connectionId: string
  bindingName: string
  serviceVersion?: string
}
export interface ODataServiceInput {
  connectionId: string
  serviceRef: string
}
export type ODataQueryInput = ODataServiceInput & ReadQuery
interface Service {
  connectionId: string
  identity: object
  origin: string
  root: string
  bindingName: string
  serviceName: string
  version: string
  expiresAt: number
}
interface Context {
  connection: ODataConnection
  cancelled: () => boolean
}
const MAX_RESPONSE = 512 * 1024
const TTL = 15 * 60 * 1000

const bodyRedacted = (body: string) =>
  body
    .replace(/Bearer\s+\S+|eyJ[A-Za-z\d_.-]{20,}/gi, "[redacted]")
    .replace(
      /("(?:access_token|refresh_token|id_token|client_secret|password|authorization|cookie|set-cookie|x-csrf-token|csrfToken|samlresponse)"\s*:\s*")[^"]*"/gi,
      '$1[redacted]"'
    )
    .replace(
      /(<(?:[\w.-]+:)?(?:password|remotePassword|token|Cookie)\b[^>]*>)[\s\S]*?(<\/(?:[\w.-]+:)?(?:password|remotePassword|token|Cookie)>)/gi,
      "$1[redacted]$2"
    )
    .slice(0, 2000)

export class ODataHttpFailure extends ODataReadError {
  constructor(
    readonly httpStatus: number | undefined,
    readonly responseBody?: string
  ) {
    super(
      httpStatus && httpStatus >= 300 && httpStatus < 400
        ? "AUTH_REDIRECT"
        : httpStatus === 401
          ? "AUTH_REQUIRED"
          : httpStatus === 403
            ? "FORBIDDEN"
            : httpStatus === 404
              ? "NOT_FOUND"
              : httpStatus === 406
                ? "UNSUPPORTED_REPRESENTATION"
                : "ODATA_REQUEST_FAILED",
      "Read failed. Check the active SAP login, service publication and permissions; no write or automatic publication was performed."
    )
  }
}
function failure(error: unknown): ODataReadError {
  if (error instanceof ODataReadError) return error
  const source = node(error)
  const response = node(source.response || node(source.parent).response)
  const status = response.status || response.statusCode || source.status || source.err
  const body =
    typeof response.body === "string"
      ? response.body
      : typeof response.data === "string"
        ? response.data
        : undefined
  const loginBody =
    /text\/html/i.test(String(node(response.headers)["content-type"] || "")) ||
    /<(?:html|form)\b|<!doctype html|<(?:[\w.-]+:)?Assertion\b/i.test(body || "")
  if (typeof source.message === "string" && /maxContentLength/i.test(source.message))
    return new ODataReadError("RESPONSE_TOO_LARGE", "Response exceeded the read size limit")
  return new ODataHttpFailure(
    typeof status === "number" ? status : undefined,
    body && !loginBody ? bodyRedacted(body) : undefined
  )
}
export function odataReadFailure(error: unknown) {
  const safe = failure(error)
  return {
    error: safe.code,
    message: safe.message,
    ...(safe instanceof ODataHttpFailure
      ? { httpStatus: safe.httpStatus, responseBody: safe.responseBody }
      : {})
  }
}
function scopedPath(raw: string, origin: string, prefix: string) {
  const url = new URL(raw, origin)
  const decoded = decodeURIComponent(url.pathname)
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[\\%]/.test(decoded) ||
    decoded.split("/").some(part => part === "." || part === "..") ||
    !decoded.startsWith(prefix)
  )
    return reject(
      "UNSUPPORTED_SERVICE_ORIGIN",
      "This preview accepts same-origin scoped SAP service paths only"
    )
  return url.pathname
}

export class ODataReadService {
  private services = new Map<string, Service>()
  private now: () => number
  constructor(private dependencies: ODataDependencies) {
    this.now = dependencies.now || Date.now
  }

  private async context(connectionId: string, cancelled: () => boolean): Promise<Context> {
    if (!connectionId?.trim()) reject("CONNECTION_REQUIRED", "Specify an active SAP connection")
    if (cancelled()) reject("CANCELLED", "Read cancelled")
    const connection = await this.dependencies.connection(connectionId.trim().toLowerCase())
    if (new URL(connection.baseUrl).protocol !== "https:")
      reject("HTTPS_REQUIRED", "OData reads require HTTPS")
    return { connection, cancelled }
  }

  // Tylko GET, bez przekierowań i z limitem odpowiedzi; ogranicz także czas odświeżania logowania.
  private async get(
    context: Context,
    path: string,
    accept: string,
    query: Record<string, string | number> = {}
  ) {
    if (context.cancelled()) reject("CANCELLED", "Read cancelled")
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([
        context.connection.request(path, {
          method: "GET",
          headers: { Accept: accept },
          qs: { ...query, "sap-client": context.connection.sapClient },
          timeout: 15000,
          maxRedirects: 0,
          maxContentLength: MAX_RESPONSE
        }),
        new Promise<never>((_, rejectTimeout) => {
          timer = setTimeout(
            () =>
              rejectTimeout(
                new ODataReadError(
                  "READ_TIMEOUT",
                  "Read or authentication timed out. Reconnect in ABAP FS before retrying."
                )
              ),
            25000
          )
        })
      ])
      if (context.cancelled()) reject("CANCELLED", "Read cancelled")
      if (response.status < 200 || response.status >= 300) throw failure({ response })
      if (Buffer.byteLength(response.body || "", "utf8") > MAX_RESPONSE)
        reject("RESPONSE_TOO_LARGE", "Response exceeded the read size limit")
      const contentType = String(response.headers["content-type"] || "")
      if (
        /text\/html/i.test(contentType) ||
        /^\s*(?:<!doctype html|<html)/i.test(response.body || "")
      )
        reject(
          "AUTH_REQUIRED",
          "Received an HTML page instead of OData; reconnect with the appropriate SAP identity"
        )
      return response
    } catch (error) {
      throw failure(error)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async represented(
    context: Context,
    path: string,
    representations: string[],
    query: Record<string, string | number> = {}
  ) {
    for (let i = 0; i < representations.length; i++) {
      try {
        return await this.get(context, path, representations[i], query)
      } catch (error) {
        if (
          !(error instanceof ODataHttpFailure) ||
          error.httpStatus !== 406 ||
          i === representations.length - 1
        )
          throw error
      }
    }
    return reject("UNSUPPORTED_REPRESENTATION", "No supported ADT representation")
  }

  async resolve(input: ResolveODataInput, cancelled = () => false) {
    const context = await this.context(input.connectionId, cancelled)
    const name = input.bindingName?.trim().toUpperCase()
    if (!name || !/^[A-Z0-9_/]+$/.test(name) || name.length > 60)
      reject("INVALID_BINDING", "Specify an ABAP service binding name")
    const origin = new URL(context.connection.baseUrl).origin
    const bindingPath =
      "/sap/bc/adt/businessservices/bindings/" + encodeURIComponent(name.toLowerCase())
    const bindingResponse = await this.represented(context, bindingPath, [
      "application/vnd.sap.adt.businessservices.servicebinding.v2+xml",
      "application/vnd.sap.adt.businessservices.servicebinding.v1+xml"
    ])
    const binding = node(xml(bindingResponse.body).serviceBinding)
    if (attribute(binding, "version") !== "active")
      reject("ACTIVE_BINDING_REQUIRED", "Expected the active service binding")
    if (
      attribute(binding.binding, "type") !== "ODATA" ||
      attribute(binding.binding, "version") !== "V4"
    )
      reject("UNSUPPORTED_ODATA_VERSION", "This preview resolves OData V4 bindings only")
    if (attribute(binding, "published") === "false")
      reject("NOT_PUBLISHED", "Binding is not published; this read tool never publishes it")
    const link = nodes(binding.link).find(
      link => attribute(link, "rel") === "http://www.sap.com/categories/odatav4"
    )
    if (!link) reject("MISSING_SERVICE_LINK", "Binding has no advertised OData V4 details link")
    const candidates = nodes(binding.services)
      .flatMap(group =>
        nodes(group.content).map(content => ({
          name: attribute(group, "name"),
          version: attribute(content, "version"),
          definition: attribute(content.serviceDefinition, "name")
        }))
      )
      .filter(candidate => !input.serviceVersion || candidate.version === input.serviceVersion)
    if (candidates.length !== 1)
      reject("AMBIGUOUS_SERVICE", "Choose an exact advertised serviceVersion for this binding")
    const candidate = candidates[0]
    const detailsPath = scopedPath(
      attribute(link, "href"),
      origin,
      "/sap/bc/adt/businessservices/odatav4/"
    )
    const details = await this.represented(
      context,
      detailsPath,
      [
        "application/vnd.sap.adt.businessservices.odatav4.v2+xml",
        "application/vnd.sap.adt.businessservices.odatav4.v1+xml"
      ],
      {
        servicename: candidate.name,
        serviceversion: candidate.version,
        srvdname: candidate.definition
      }
    )
    const group = node(xml(details.body).serviceGroup)
    if (attribute(group, "published") !== "true")
      reject("PUBLICATION_UNKNOWN", "Service publication is not confirmed by the backend")
    const services = nodes(group.services).filter(
      service => attribute(service, "serviceVersion") === candidate.version
    )
    if (services.length !== 1)
      reject("AMBIGUOUS_SERVICE", "Backend did not return one matching service")
    const root = scopedPath(attribute(services[0], "serviceUrl"), origin, "/sap/opu/odata4/")
    if (!root.endsWith("/"))
      reject("INVALID_SERVICE_ROOT", "Expected a canonical service root ending in slash")
    for (const [ref, service] of this.services)
      if (service.expiresAt <= this.now()) this.services.delete(ref)
    if (this.services.size >= 100)
      reject("TOO_MANY_SERVICES", "Too many unexpired service references")
    const serviceRef = randomUUID()
    const expiresAt = this.now() + TTL
    this.services.set(serviceRef, {
      connectionId: input.connectionId.trim().toLowerCase(),
      identity: context.connection.identity,
      origin,
      root,
      bindingName: name,
      serviceName: candidate.name,
      version: candidate.version,
      expiresAt
    })
    return {
      serviceRef,
      bindingName: name,
      serviceName: candidate.name,
      serviceVersion: candidate.version,
      servicePath: root,
      protocol: "V4",
      published: true,
      authContext: "existing_same_origin_adt_oauth",
      expiresAt: new Date(expiresAt).toISOString()
    }
  }

  private async service(input: ODataServiceInput, cancelled: () => boolean) {
    const service = this.services.get(input.serviceRef)
    if (!service || service.expiresAt <= this.now())
      reject(
        "SERVICE_EXPIRED",
        "Resolve this service again; references expire and do not survive restart"
      )
    if (service.connectionId !== input.connectionId?.trim().toLowerCase())
      reject("SERVICE_MISMATCH", "Reference belongs to another SAP connection")
    const context = await this.context(input.connectionId, cancelled)
    if (
      context.connection.identity !== service.identity ||
      new URL(context.connection.baseUrl).origin !== service.origin
    )
      reject("SERVICE_EXPIRED", "Connection changed; resolve the service again")
    return { context, service }
  }

  private async metadata(context: Context, service: Service) {
    const response = await this.get(context, service.root + "$metadata", "application/xml")
    return {
      response,
      model: readModel(response.body),
      hash: createHash("sha256").update(response.body).digest("hex")
    }
  }

  async getMetadata(input: ODataServiceInput, cancelled = () => false) {
    const { context, service } = await this.service(input, cancelled)
    const { response, model, hash } = await this.metadata(context, service)
    return {
      serviceRef: input.serviceRef,
      httpStatus: response.status,
      protocol: "V4",
      metadataVersion: model.version,
      metadataHash: hash,
      entitySets: model.entitySets.map(set => ({
        name: set.name,
        type: set.type,
        keys: model.types.get(set.type)?.keys || [],
        properties: model.types.get(set.type)?.properties || [],
        navigations: model.types.get(set.type)?.navigations || [],
        resolved: model.types.has(set.type)
      })),
      externalReferenceCount: model.externalReferenceCount,
      externalReferencesFetched: false,
      note: "Single-document V4 XML model. Declared metadata is not proof of authorization; no external schemas were fetched."
    }
  }

  // Odśwież kontrakt przed GET; model nie przekazuje URL, nagłówków ani dowolnego query string.
  async query(input: ODataQueryInput, cancelled = () => false) {
    const { context, service } = await this.service(input, cancelled)
    const { model, hash } = await this.metadata(context, service)
    const plan = planQuery(model, input)
    const response = await this.get(
      context,
      service.root + encodeURIComponent(plan.entitySet),
      "application/json;IEEE754Compatible=true",
      plan.query
    )
    let parsed: unknown
    try {
      parsed = JSON.parse(response.body)
    } catch {
      return reject("INVALID_JSON", "Expected a JSON OData response")
    }
    return {
      serviceRef: input.serviceRef,
      httpStatus: response.status,
      metadataHash: hash,
      entitySet: plan.entitySet,
      ...projectRows(parsed, plan),
      rowLimit: plan.top,
      paginationFollowed: false
    }
  }
}

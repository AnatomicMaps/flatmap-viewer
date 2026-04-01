/*==============================================================================

Flatmap viewer and annotation tool

Copyright (c) 2019 - 2026  David Brooks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

==============================================================================*/

import initOxigraph from '../assets/oxigraph/web.js'
import * as oxigraphModule from '../assets/oxigraph/web'

import type * as $oxigraph from 'oxigraph/web'

import { write as prettyTurtle } from '@jeswr/pretty-turtle'

//==============================================================================

export async function initialise(module_or_path?: {
    module_or_path: $oxigraph.InitInput | Promise<$oxigraph.InitInput>
} | $oxigraph.InitInput | Promise<$oxigraph.InitInput>): Promise<$oxigraph.InitOutput> {
    const wasm = await initOxigraph(module_or_path)
    globalThis.rdfModule = oxigraphModule
    return wasm
}

export function initialised(): boolean {
    return !!globalThis.rdfModule
}

//==============================================================================
//==============================================================================

type Quad = $oxigraph.Quad

type Variable = $oxigraph.Variable

//==============================================================================

export type Term = $oxigraph.Term

//==============================================================================

export type BlankNode = $oxigraph.BlankNode

export function blankNode(value: string|undefined=undefined): BlankNode {
    return globalThis.rdfModule.blankNode(value)
}

export function isBlankNode(term: unknown): boolean {
    // @ts-expect-error: term is of unknown type
    return !!term.termType && term.termType === 'BlankNode'
}

//==============================================================================

export type Literal = $oxigraph.Literal

export function literal(value: string|number|boolean, datatype: NamedNode|undefined=undefined): Literal {
    return globalThis.rdfModule.literal(value, datatype)
}

export function isLiteral(term: unknown): boolean {
    // @ts-expect-error: term is of unknown type
    return !!term.termType && term.termType === 'Literal'
}

//==============================================================================

export interface NamedNode extends $oxigraph.NamedNode {
    uri: string
    id: () => string
}

function makeNamedNode(term: Term): NamedNode | Term {
    if (isNamedNode(term)) {
        (term as NamedNode).uri = term.value;
        (term as NamedNode).id = () => {
            let parts = term.value.split('#')
            if (parts.length < 2) {
                parts = term.value.split('/')
            }
            // biome-ignore lint/style/noNonNullAssertion: parts is not empty
            return parts.length > 1 ? parts.at(-1)! : ''
        }
        return term as NamedNode
    }
    return term
}

export function namedNode(value: string): NamedNode {
    return makeNamedNode(globalThis.rdfModule.namedNode(value)) as NamedNode
}

export function isNamedNode(term: unknown): boolean {
    // @ts-expect-error: term is of unknown type
    return !!term.termType && term.termType === 'NamedNode'
}

//==============================================================================

export type SubjectType = BlankNode | NamedNode | Quad | Variable
export type PredicateType = NamedNode | Variable
export type ObjectType = BlankNode | Literal | NamedNode | Quad | Variable

export interface Statement extends Quad {
    subject: SubjectType
    predicate: PredicateType
    object: ObjectType
}

function makeStatement(quad: Quad): Statement {
    return {
        graph: makeNamedNode(quad.graph),
        object: makeNamedNode(quad.object),
        predicate: makeNamedNode(quad.predicate),
        subject: makeNamedNode(quad.subject),
        termType: quad.termType,
        value: quad.value
    } as Statement
}

//==============================================================================

export type ContentType = string

export const TurtleContentType: ContentType = 'text/turtle'

//==============================================================================
//==============================================================================

export type QueryOptions = {
    base_iri?: NamedNode | string
    results_format?: string
    default_graph?: BlankNode | $oxigraph.DefaultGraph | NamedNode | Iterable<BlankNode | $oxigraph.DefaultGraph | NamedNode>
    named_graphs?: Iterable<BlankNode | NamedNode>
    use_default_graph_as_union?: boolean
}

export type QueryResult = boolean | Map<string, Term>[] | Quad[] | string

//==============================================================================

export class RdfStore {
    #rdfStore: $oxigraph.Store

    constructor() {
        this.#rdfStore = new globalThis.rdfModule.Store()
    }

    get size(): number {
        let size = 0
        const count = this.query(`
            SELECT (COUNT(*) AS ?count)
                WHERE { ?s ?p ?o }
        `)
        if (count instanceof Map) {
            (<Map<string, Term>[]>count).forEach((r) => {
                size = Number(r.get('count')?.value || 0)
            })
        }
        return size
    }

    statements(graph: NamedNode | null = null): Statement[] {
        return this.statementsMatching(null, null, null, graph)
    }

    add(s: SubjectType, p: PredicateType, o: ObjectType, g: NamedNode|null = null): Statement {
        const statement = globalThis.rdfModule.quad(s, p, o, g || globalThis.rdfModule.defaultGraph())
        this.#rdfStore.add(statement)
        return makeStatement(statement)
    }

    addStatements(statements: Statement[], graph: NamedNode|null = null) {
        for (const statement of statements) {
            this.add(statement.subject, statement.predicate, statement.object, graph)
        }
    }

    contains(
        s: SubjectType | null = null,
        p: PredicateType | null = null,
        o: ObjectType | null = null,
        g: NamedNode | null = null
    ): boolean {
        return this.#rdfStore.match(s, p, o, g || globalThis.rdfModule.defaultGraph()).length > 0
    }

    load(baseIri: string|null=null, rdf: string, contentType: ContentType=TurtleContentType, graph: NamedNode|null=null) {
        try {
            this.#rdfStore.load(rdf, {
                format: contentType,
                base_iri: baseIri || undefined,
                to_graph_name: graph || globalThis.rdfModule.defaultGraph()
            })
        } catch (error) {
            throw new Error(`Error parsing RDF: ${(<Error>error).message}`)
        }
    }

    removeStatements(
        s: SubjectType | null = null,
        p: PredicateType | null = null,
        o: ObjectType | null = null,
        g: NamedNode | null = null
    ) {
        const statements = this.#rdfStore.match(s, p, o, g || globalThis.rdfModule.defaultGraph())
        for (const statement of statements) {
            this.#rdfStore.delete(statement)
        }
    }

    async serialise(
        baseIri: string,
        contentType: ContentType = TurtleContentType,
        namespaces: Record<string, string> = {},
        graph: NamedNode | null = null
    ): Promise<string> {
        if (contentType === TurtleContentType) {
            const quads = this.#rdfStore.match(null, null, null, graph || globalThis.rdfModule.defaultGraph())
            const turtle = await prettyTurtle(quads, {
                format: 'text/turtle',
                prefixes: Object.assign({ '': `${baseIri}#` }, namespaces),
                baseIri: baseIri,
                explicitBaseIRI: true,
                compact: false,
                ordered: true
            })
            return turtle.replaceAll(baseIri, '')
        } else {
            return this.#rdfStore.dump({
                format: contentType,
                from_graph_name: graph || globalThis.rdfModule.defaultGraph()
            })
        }
    }

    query(sparql: string, options: QueryOptions={}): QueryResult {
        try {
            const results = this.#rdfStore.query(sparql, options) as Map<string, Term>[]
            if (results instanceof Map) {
                for (const result of results) {
                    for (const term of result.values()) {
                        makeNamedNode(term)
                    }
                }
            }
            return results
        } catch (error) {
            console.log(`Error parsing SPARQL query: ${(<Error>error).message} ${sparql}`)
            let inLib = true
            for (const location of (<Error>error).stack.split('\n')) {
                if (inLib) {
                    inLib = location.indexOf('RdfStore.query') < 0
                } else {
                    console.log(location)
                }
            }
        }
        return []
    }

    statementsMatching(
        s: SubjectType | null = null,
        p: PredicateType | null = null,
        o: ObjectType | null = null,
        g: NamedNode | null = null
    ): Statement[] {
        const statements: Quad[] = this.#rdfStore.match(s, p, o, g || globalThis.rdfModule.defaultGraph())
        return statements.map((s) => makeStatement(s))
    }

    subjectsOfType(parentType: NamedNode): [SubjectType, NamedNode][] {
        const subjects = this.query(
            `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT ?s ?t WHERE {
    ?s rdf:type/rdfs:subClassOf* <${parentType.uri}> .
    ?s rdf:type ?t .
  } ORDER BY ?s`,
            { use_default_graph_as_union: true }
        )
        if (subjects instanceof Map) {
            return (<Map<string, Term>[]>subjects).map((r) => [r.get('s') as SubjectType,
                      r.get('t') as NamedNode])
        }
        return []
    }

    update(sparql: string): void {
        try {
            this.#rdfStore.update(sparql)
        } catch (error) {
            console.log(`Error parsing SPARQL update: ${(<Error>error).message} ${sparql}`)
            let inLib = true
            for (const location of (<Error>error).stack.split('\n')) {
                if (inLib) {
                    inLib = location.indexOf('RdfStore.update') < 0
                } else {
                    console.log(location)
                }
            }
        }
    }
}

//==============================================================================
//==============================================================================

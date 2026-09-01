/*==============================================================================

Flatmap viewer and annotation tool

Copyright (c) 2019 - 2025  David Brooks

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

import type {Pair} from './types'

//==============================================================================

// A PMID is a "1- to 8-digit accession number with no leading zeros"
const ZERO_PAD_PREFIXES = {
    'ILX':    7,
    'UBERON': 7
}

//==============================================================================

export class List<T> extends Array<T> {
    constructor(iterable: Iterable<T>|null=null) {
        super()
        if (iterable !== null)
            this.extend(iterable)
    }

    append(element: T)
    //================
    {
        super.push(element)
        return this
    }

    contains(element: T)
    //==================
    {
        return (super.includes(element))
    }

    extend(other: Iterable<T>)
    //========================
    {
        if (this === other) {
            throw new Error('Cannot extend a list with itself...')
        } else if (other) {
            super.push(...other)
        }
        return this
    }

    slice(start: number, end: number): List<T>
    //========================================
    {
        return new List([...this].slice(start, end))
    }
}

//==============================================================================

// From https://spin.atomicobject.com/2018/09/10/javascript-concurrency/

export class Mutex
{
    #mutex: Promise<void>

    constructor()
    {
        this.#mutex = Promise.resolve()
    }

    lock(): PromiseLike<() => void>
    //=============================
    {
        let begin = (_) => {}

        this.#mutex = this.#mutex.then(() => {
            return new Promise(begin)
        })

        return new Promise(res => {
            begin = res
        })
    }

    async dispatch(fn: (() => void) | (() => PromiseLike<void>)): Promise<void>
    //=========================================================================
    {
        const unlock = await this.lock()

        try {
            return await Promise.resolve(fn())
        } finally {
            unlock()
        }
    }
}

//==============================================================================

export function normaliseId(id: string): string
{
    if (!id.includes(':')) {
        return id
    }
    const parts = id.split(':')
    const lastPart = parts[parts.length - 1]
    const prefix = parts[0].toUpperCase()
    if (prefix in ZERO_PAD_PREFIXES && '0123456789'.includes(lastPart[0])) {
        parts[parts.length - 1] = lastPart.padStart(ZERO_PAD_PREFIXES[prefix], '0')
        return parts.join(':')
    }
    return id
}

//==============================================================================

export function setDefaults(options: object | null | undefined, defaultOptions: object): object
{
    if (!options) {
        return defaultOptions
    }
    for (const [key, value] of Object.entries(defaultOptions)) {
        if (!(key in options)) {
            options[key] = value
        }
    }
    return options
}

//==============================================================================

export function reverseMap<K, V>(mapping: Map<K, Array<V>|Set<V>>): Map<V, Set<K>>
//================================================================================
{
    const reverse: Map<V, Set<K>> = new Map()
    for (const [key, values] of mapping.entries()) {
        for (const value of values) {
            if (reverse.has(value)) {
                reverse.get(value)!.add(key)
            } else {
                reverse.set(value, new Set([key]))
            }
        }
    }
    return reverse
}

//==============================================================================

export function delay(fn, wait: number = 0)
{
    let timeout: NodeJS.Timeout
    return function(...args) {
        clearTimeout(timeout)
        timeout = setTimeout(() => fn.apply(this, args), wait)
    }
}

//==============================================================================

// From https://stackoverflow.com/a/65064026

export function pairwise<T>(a: T[]): Pair<T>[]
{
    return a.flatMap( (x: T) => {
        return a.flatMap( (y: T): Pair<T>[] => {
            return (x !== y) ? [[x, y]] : []
        })
    })
}

//==============================================================================

export function wait(ms: number): Promise<NodeJS.Timeout>
{
    return new Promise(r => setTimeout(r, ms))
}

//==============================================================================

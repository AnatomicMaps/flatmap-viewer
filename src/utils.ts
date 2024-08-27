/*==============================================================================

Flatmap viewer and annotation tool

Copyright (c) 2019  David Brooks

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

// A PMID is a "1- to 8-digit accession number with no leading zeros"
const ZERO_PAD_PREFIXES = {
    'ILX':    7,
    'UBERON': 7
}

//==============================================================================

export class List<T> extends Array<T> {
    constructor(iterable=null) {
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

    extend(other: Array<T>)
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
        return new List(Array(...this).slice(start, end))
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
        let begin = _ => {}

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
    if (parts[0].toUpperCase() in ZERO_PAD_PREFIXES && '0123456789'.includes(lastPart[0])) {
        parts[parts.length - 1] = lastPart.padStart(ZERO_PAD_PREFIXES[parts[0].toUpperCase()], '0')
        return parts.join(':')
    }
    return id
}

//==============================================================================

export function setDefaults(options: Object | null | undefined, defaultOptions: Object): Object
{
    if (options === undefined || options === null) {
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

export function reverseMap(mapping: Object): Object
//=================================================
{
    const reverse = {}
    for (const [key, values] of Object.entries(mapping)) {
        for (const value of values) {
            if (value in reverse) {
                reverse[value].add(key)
            } else {
                reverse[value] = new Set([key])
            }
        }
    }
    return reverse
}

//==============================================================================

export function delay(fn, wait: number = 0)
{
    let timeout
    return function(...args) {
        clearTimeout(timeout)
        timeout = setTimeout(() => fn.apply(this, args), wait)
    }
}

//==============================================================================

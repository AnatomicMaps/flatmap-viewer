/*==============================================================================

Flatmap viewer and annotation tool

Copyright (c) 2019 - 2024 David Brooks

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

import type {PropertiesType, PropertyKey, PropertyValue, ScalarType} from '../types'

//==============================================================================

/**
 * `True` iff all `PropertiesFilterExpressions` are `true`
 */
export type AndCondition = {
    AND: PropertiesFilterExpression[]
}

/**
 * `True` iff either the PropertyKey identifies an empty array in the `properties`
 * record or the item is not an array
 */
export type EmptyCondition = {
    EMPTY: PropertyKey
}

/**
 * `True` iff the `PropertyKey` is in the given `properties` record
 */
export type HasCondition = {
    HAS: PropertyKey
}

/**
 * `True` iff either the PropertyKey identifies an array in the `properties` record and
 * the `PropertyValue` is included in the array or the item is not an array
 */
export type InCondition = {
    IN: [PropertyValue, PropertyKey]
}

/**
 * `True` iff the `PropertiesFilterExpression` is `false`
 */
export type NotCondition = {
    NOT: PropertiesFilterExpression
}

/**
 * `True` iff any `PropertiesFilterExpression` is `true`
 */
export type OrCondition = {
    OR: PropertiesFilterExpression[]
}

/**
 * Compare the value of `properties[key]` in the given `properties`
 * record with `PropertyValue` and resolve `True` iff either:
 *
 * 1.  `value` and `PropertyValue` are both arrays and they
 *     have at least one common value, or:
 * 2.   `value` is an array which includes `PropertyValue`, or:
 * 3.  `PropertyValue` is an array which includes `value`, or:
 * 4.  neither are arrays and `value` is equal to `PropertyValue`
 */
export type PropertyValueTest = { [key: PropertyKey]: PropertyValue }


export type PropertiesFilterExpression = AndCondition
                                       | EmptyCondition
                                       | HasCondition
                                       | InCondition
                                       | NotCondition
                                       | OrCondition
                                       | PropertyValueTest
                                       | boolean

//==============================================================================

export type StyleFilterValue = ScalarType | StyleFilterType

export type StyleFilterType = [string, ...StyleFilterValue[]]

//==============================================================================

export class PropertiesFilter
{
    #filter: PropertiesFilterExpression

    constructor(filter: PropertiesFilterExpression=true)
    //==================================================
    {
        if (filter.constructor !== Object) {    // We allow boolean values
            this.#filter = filter
        } else {
            this.#filter = Object.assign({}, filter)
        }
    }

    get filter()
    //==========
    {
        return this.#filter
    }

    clear()
    //=====
    {
        if (this.#filter !== true) {
            this.#filter = true
        }
    }

    expand(filter: PropertiesFilterExpression)
    //========================================
    {
        if (this.#filter === false) {
            this.#filter = filter
        } else if (this.#filter !== true) {
            const copiedFilter = Object.assign({}, filter) as PropertiesFilterExpression
            this.#filter = { OR: [this.#filter, copiedFilter] }
        }
    }

    invert()
    //======
    {
        if (this.#filter === false) {
            this.#filter = true
        } else if (this.#filter === true) {
            this.#filter = false
        } else {
            const copiedFilter = Object.assign({}, this.#filter) as PropertiesFilterExpression
            this.#filter = { NOT: copiedFilter }
        }
    }

    getStyleFilter(): StyleFilterType
    //===============================
    {
        return this.#makeStyleFilter(this.#filter)
    }

    match(properties: PropertiesType): boolean
    //========================================
    {
        return this.#match(properties, this.#filter)
    }

    narrow(filter: PropertiesFilterExpression)
    //========================================
    {
        if (this.#filter === true) {
            this.#filter = filter
        } else if (this.#filter !== false) {
            const copiedFilter = Object.assign({}, filter) as PropertiesFilterExpression
            this.#filter = { AND: [this.#filter, copiedFilter] }
        }
    }

    setFilter(filter: PropertiesFilterExpression)
    //===========================================
    {
        if (filter.constructor !== Object) {
            this.#filter = filter
        } else {
            this.#filter = Object.assign({}, filter)
        }
    }

    #makeStyleFilter(filter: PropertiesFilterExpression): StyleFilterType
    //===================================================================
    {
        if (filter.constructor !== Object) {
            return ['boolean', !!filter]
        }
        const styleFilter = []
        for (const [key, expr] of Object.entries(filter)) {
            if (key === 'AND' || key === 'OR') {
                if (Array.isArray(expr) && expr.length >= 1) {
                    styleFilter.push((key === 'AND') ? 'all' : 'any',
                                      ...expr.map(e => this.#makeStyleFilter(e)))
                } else {
                    console.warn(`makeFilter: Invalid ${key} operands: ${expr}`)
                }
            } else if (key === 'EMPTY') {
                styleFilter.push('==', ['get', expr], '[]')
            } else if (key === 'HAS') {
                styleFilter.push('has', expr)
            } else if (key === 'IN') {
                styleFilter.push('in', expr[0], ['get', expr[1]])
            } else if (key === 'NOT') {
                const filterExpr = this.#makeStyleFilter(expr)
                if (Array.isArray(filterExpr)) {
                    if (filterExpr.length === 3 && ['==', '!='].includes(filterExpr[0])) {
                        if (filterExpr[0] === '==') {
                            styleFilter.push('!=', filterExpr[1], filterExpr[2])
                        } else {
                            styleFilter.push('==', filterExpr[1], filterExpr[2])
                        }
                    } else {
                        styleFilter.push('!', filterExpr)
                    }
                } else {
                    styleFilter.push(!filterExpr)
                }
            } else {
                if (Array.isArray(expr)) {
                    styleFilter.push('any', ...expr.map(e => ['==', ['get', key], e]))
                } else {
                    styleFilter.push('==', ['get', key], expr)
                }
            }
        }
        return styleFilter as StyleFilterType
    }

    #match(properties: PropertiesType, filter: PropertiesFilterExpression): boolean
    //=============================================================================
    {
        if (filter.constructor !== Object) {
            return !!filter
        }
        for (const [key, expr] of Object.entries(filter)) {
            let matched = true
            if (key === 'AND' || key === 'OR') {
                if (Array.isArray(expr) && expr.length >= 1) {
                    const matches = expr.map(e => this.#match(properties, e))
                    matched = (key === 'AND') ? matches.reduce((result, match) => result && match, true)
                                              : matches.reduce((result, match) => result || match, false)
                } else {
                    console.warn(`makeFilter: Invalid ${key} operands: ${expr}`)
                }
            } else if (key === 'EMPTY') {
                const values = properties[expr] || null
                matched = !Array.isArray(values) || (values.length === 0)
            } else if (key === 'HAS') {
                matched = (expr in properties)
            } else if (key === 'IN') {
                const values = properties[expr[1]] || null
                matched = !Array.isArray(values) || values.includes(expr[0])
            } else if (key === 'NOT') {
                matched = !this.#match(properties, expr)
            } else if (key in properties) {
                const value = properties[key]
                if (Array.isArray(value)) {
                    if (Array.isArray(expr)) {
                        matched = !(new Set(value).isDisjointFrom(new Set(expr)))
                    } else {
                        matched = value.includes(expr)
                    }
                } else if (Array.isArray(expr)) {
                    matched = expr.includes(value)
                } else {
                    matched = (value === expr)
                }
            }
            if (!matched) {
                return false
            }
        }
        return true
    }
}

//==============================================================================

const testProperties = {
    prop: 1,
    prop1: 5,
    prop2: 11,
    a: [1, 3, 5],
    b: [],
}

function testFilter(filter: PropertiesFilterExpression)
//=====================================================
{
    const featureFilter = new PropertiesFilter(filter)
    console.log(filter, '--->', featureFilter.getStyleFilter(), featureFilter.match(testProperties))
}

function _testFilters()
//=====================
{
    /*
        { HAS: 'prop' } ---> [ 'has', 'prop' ]
        { prop: 1 } ---> [ '==', 'prop', 1 ]
        { NOT: { prop: 1 } } ---> [ '!=', 'prop', 1 ]
        { NOT: { prop: [ 1, 2 ] } } ---> [ '!', [ 'any', [ '==', 'prop', 1 ], [ '==', 'prop', 2 ] ] ]
        { OR: [ { prop1: 10 }, { prop2: 11 } ] } ---> [ 'any', [ '==', 'prop1', 10 ], [ '==', 'prop2', 11 ] ]
        { AND: [ { prop1: 10 }, { prop2: 11 } ] } ---> [ 'all', [ '==', 'prop1', 10 ], [ '==', 'prop2', 11 ] ]
        { OR: [ { AND: [Array] }, { AND: [Array] } ] } ---> [
          'any',
          [ 'all', [ '!=', 'prop1', 10 ], [ '==', 'prop2', 11 ] ],
          [ 'all', [ '==', 'prop3', 10 ], [ '==', 'prop4', 11 ] ]
        ]
        { NOT: { OR: [ [Object], [Object] ] } } ---> [
          '!',
          [ 'any', [ 'all', [Array], [Array] ], [ 'all', [Array], [Array] ] ]
        ]
    */

    console.log('test properties', testProperties)

    testFilter({
        "HAS": "prop"
    })

    testFilter({
        "prop": 1
    })

    testFilter({
        "NOT": {
            "prop": 1
        }
    })

    testFilter({
        "prop": [1, 2]
    })

    testFilter({
        "IN": [5, "a"]
    })

    testFilter({
        "EMPTY": "a"
    })
    testFilter({
        "EMPTY": "b"
    })
    testFilter({
        "EMPTY": "c"
    })

    testFilter({
        "NOT": {
            "prop": [1, 2]
        }
    })

    testFilter({
        "OR": [
            {"prop1": 10},
            {"prop2": 11}
        ]
    })

    testFilter({
        "AND": [
            {"prop1": 10},
            {"prop2": 11}
        ]
    })

    testFilter({
        "OR": [{
            "AND": [
                { "NOT": {"prop1": 10}},
                {"prop2": 11}
            ]}, {
            "AND": [
                {"prop3": 10},
                {"prop4": 11}
            ]}
        ]
    })

    testFilter({
        "NOT": {
            "OR": [{
                "AND": [
                    {"prop1": 10},
                    {"prop2": 11}
                ]}, {
                "AND": [
                    {"prop3": 10},
                    {"prop4": 11}
                ]}
            ]
        }
    })

    const f1 = new PropertiesFilter({
        "AND": [
            { "NOT": {"prop1": 10}},
            {"prop2": 11}
        ]
    })
    const f2 = new PropertiesFilter({
        "AND": [
            {"prop3": 10},
            {"prop4": 11}
        ]
    })
    testFilter({
        "OR": [ f1.filter, f2.filter ]
    })


}

//==============================================================================

//_testFilters()

//==============================================================================

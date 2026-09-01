/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2025 David Brooks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

******************************************************************************/

export interface PointLike
{
    x: number
    y: number
}

export type PointArray = [number, number]

//==============================================================================

// Two points are considered to be the same if the square of the distance between
// them is no bigger than POINT_EPSILON_SQUARED

export const POINT_EPSILON         = 1e-4
export const POINT_EPSILON_SQUARED = POINT_EPSILON*POINT_EPSILON

//==============================================================================

export class Point implements PointLike
{
    constructor(readonly x: number=0, readonly y: number=0)
    {
    }

    static fromPoint(point: PointLike): Point
    {
        return new Point(point.x, point.y)
    }

    static fromArray(coords: PointArray): Point
    {
        return new Point(coords[0], coords[1])
    }

    asArray(): PointArray
    {
        return [this.x, this.y]
    }

    add(point: PointLike): Point
    {
        return Point.fromPoint(PointMath.add(this, point))
    }

    colinear(p1: PointLike, p2: PointLike, between:boolean=false): boolean
    {
        return PointMath.colinear(this, p1, p2, between)
    }

    copy(): Point
    {
        return new Point(this.x, this.y)
    }

    distance(point: PointLike): number
    {
        return PointMath.distance(this, point)
    }

    equals(point: PointLike): boolean
    {
        return PointMath.equals(this, point)
    }

    isZero(): boolean
    {
        return PointMath.isZero(this)
    }

    apply(fn: (number) => number): Point
    {
        return Point.fromPoint(PointMath.apply(this, fn))
    }

    scalarScale(scale: number): Point
    {
        return Point.fromPoint(PointMath.scalarScale(this, scale))
    }

    scale(scale: PointLike): Point
    {
        return Point.fromPoint(PointMath.scale(this, scale))
    }

    subtract(point: PointLike): Point
    {
        return Point.fromPoint(PointMath.subtract(this, point))
    }

    toString(): string
    {
        return `(${this.x}, ${this.y})`
    }
}

//==============================================================================

export class PointMath
{
    static add(p1: PointLike, p2: PointLike): Point
    {
        return new Point(p1.x + p2.x, p1.y + p2.y)
    }

    static apply(p1: PointLike, fn: (number: number) => number): Point
    {
        return new Point(fn(p1.x), fn(p1.y))
    }

    static colinear(p0: PointLike, p1: PointLike, p2: PointLike, between:boolean=false): boolean
    {
        const d0 = PointMath.distance(p0, p1)
        const d1 = PointMath.distance(p1, p2)
        const d2 = PointMath.distance(p0, p2)
        if (d2 > d0 && d2 > d1) {
            return (d0 + d1) < d2*(1 + POINT_EPSILON)
        } else if (between) {
            return false
        } else if (d1 > d0 && d1 > d2) {
            return (d0 + d2) < d1*(1 + POINT_EPSILON)
        } else {
            return (d1 + d2) < d0*(1 + POINT_EPSILON)
        }
    }

    static distance(p1: PointLike, p2: PointLike): number
    {
        return Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2)
    }

    static equals(p1: PointLike, p2: PointLike): boolean
    {
        return ((p1.x - p2.x)**2 + (p1.y - p2.y)**2) <= POINT_EPSILON_SQUARED
    }

    static isZero(pt: PointLike): boolean
    {
        return (pt.x**2 + pt.y**2) <= POINT_EPSILON_SQUARED
    }

    static scalarScale(p1: PointLike, scale: number): Point
    {
        return new Point(scale*p1.x, scale*p1.y)
    }

    static scale(p1: PointLike, scale: PointLike): Point
    {
        return new Point(scale.x*p1.x, scale.y*p1.y)
    }

    static subtract(p1: PointLike, p2: PointLike): Point
    {
        return new Point(p1.x - p2.x, p1.y - p2.y)
    }
}

//==============================================================================

/******************************************************************************

Flatmap viewer and annotation tool

Copyright (c) 2019 - 2025 David Brooks

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

import type { FlatMap } from '../../lib'

//==============================================================================

export type DrawEvent = Event & {
    feature
}

//==============================================================================

export class DrawControl
{
    #cancelBtn: HTMLElement|null
    #flatmap: FlatMap
    #idField: HTMLElement|null
    #lastEvent: DrawEvent|null = null
    #okBtn: HTMLElement|null

    constructor(flatmap: FlatMap)
    {
        this.#flatmap = flatmap
        this.#idField = document.getElementById('drawing-id')

        this.#okBtn = document.getElementById('drawing-ok')
        if (this.#okBtn) {
            this.#okBtn.addEventListener('click', e => {
                if (this.#lastEvent) {
                    const feature = this.#flatmap.refreshAnnotationFeatureGeometry(this.#lastEvent.feature)
                    this.#flatmap.commitAnnotationEvent(this.#lastEvent)
                    this.#idField!.innerText = ''
                    this.#lastEvent = null
                    // Send `feature`, along with user comments, to the annotation service
                }
            })
        }

        this.#cancelBtn = document.getElementById('drawing-cancel')
        if (this.#cancelBtn) {
            this.#cancelBtn.addEventListener('click', e => {
                if (this.#lastEvent) {
                    this.#flatmap.rollbackAnnotationEvent(this.#lastEvent)
                    this.#idField!.innerText = ''
                    this.#lastEvent = null
                }
            })
        }
    }

    handleEvent(event: DrawEvent)
    //===========================
    {
        console.log(event)
        if (this.#idField && event.type !== 'modeChanged' && event.type !== 'selectionChanged') {
            this.#idField.innerText = `Annotation ${event.type}, Id: ${event.feature.id}`
            this.#lastEvent = event
        }
    }
}

//==============================================================================

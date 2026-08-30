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

import {Control} from './controls'
import type {FlatMap} from '../flatmap'
import type {System} from '../systems'

//==============================================================================

export class SystemsControl extends Control
{
    #systems: System[]

    constructor(flatmap: FlatMap, systems: System[])
    {
        super(flatmap, 'system', 'systems')
        this.#systems = systems
    }

    addControlDetails()
    //=================
    {
        let lines = 0
        let enabled = 0
        for (const system of this.#systems) {
            const input = this.addControlLine(`${this.prefix}${system.id}`, system.name, `background: ${system.colour};`)
            if (system.enabled) {
                input.checked = true
                enabled += 1
            }
            lines += 1
        }
        return {
            enabled: enabled,
            total: lines
        }
    }

    enableAll(enable: boolean)
    //========================
    {
        for (const system of this.#systems) {
            const checkbox = this.getControlInput(`${this.prefix}${system.id}`)
            if (checkbox) {
                checkbox.checked = enable
                this.flatmap.enableSystem(system.id, enable)
            }
        }
    }

    enableControl(id: string, enable: boolean)
    //========================================
    {
        for (const system of this.#systems) {
            if (id === system.id) {
                this.flatmap.enableSystem(system.id, enable)
            }
        }
    }
}

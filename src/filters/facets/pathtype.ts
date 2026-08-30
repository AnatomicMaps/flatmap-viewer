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

import {type PathType, PATHWAYS_LAYER} from '../../pathways'
import {PropertiesFilter, type PropertiesFilterExpression} from '..'
import {Facet, FilteredFacet} from '.'

//==============================================================================

export class PathTypeFacet extends FilteredFacet
{
    #centrelinesEnabled: boolean = false

    constructor(pathTypes: PathType[])
    {
        super(new Facet('pathtypes', pathTypes.map(pt => {
            return {
                id: pt.type,
                label: pt.label,
                enabled: pt.enabled,
                properties: {
                    colour: pt.colour,
                    dashed: pt.dashed || false
                }
            }
        })))
    }

    enableCentrelines(enable=true)
    //============================
    {
        this.#centrelinesEnabled = enable
    }

    makeFilter(): PropertiesFilter
    //============================
    {
        const enabledPathTypes = this.facet.enabledStates
        if (this.#centrelinesEnabled) {
            enabledPathTypes.push('centreline')
        }
        const pathCondition: PropertiesFilterExpression =
            (enabledPathTypes.length === 0) ? (this.facet.size === 0)
                                            : {'kind': enabledPathTypes}
        return new PropertiesFilter({
            OR: [ {NOT: {'tile-layer': PATHWAYS_LAYER}},
                  {'type': 'nerve' },
                  {AND: [ {'tile-layer': PATHWAYS_LAYER},
                          {HAS: 'kind'}, pathCondition ]}
            ]
        })
    }
}

//==============================================================================

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

import {UNCLASSIFIED_TAXON_ID} from '../../flatmap'
import {PropertiesFilter, type PropertiesFilterExpression} from '..'
import {Facet, FilteredFacet} from '.'

//==============================================================================

export class TaxonFacet extends FilteredFacet
{
    constructor(taxonIds: string[])
    {
        super(new Facet('taxons', taxonIds.map(id => { return { id }})))
    }

    makeFilter(): PropertiesFilter
    //============================
    {
        const taxonCondition: PropertiesFilterExpression[] =
            this.facet.enabledStates.map(taxon => {
                return (taxon !== UNCLASSIFIED_TAXON_ID)
                    ? { 'IN': [taxon, 'taxons'] }
                    : { 'HAS': 'taxons' }
                }
            )
        if (taxonCondition.length === 0) {
            taxonCondition.push(this.facet.size === 0)
        }
        return new PropertiesFilter(
           { OR: [{'NOT': {'HAS': 'taxons'}}, ...taxonCondition] }
        )
    }
}

//==============================================================================

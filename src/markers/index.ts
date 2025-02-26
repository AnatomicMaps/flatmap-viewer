/*==============================================================================

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

==============================================================================*/

import {Map as MapLibreMap} from 'maplibre-gl'

import {SvgManager, SvgTemplateManager} from '../../thirdParty/maplibre-gl-svg/src'

//==============================================================================

export const CLUSTERED_MARKER_ID = 'clustered-marker'
export const UNCLUSTERED_MARKER_ID = 'unclustered-marker'
export const ZOOM_MARKER_ID = 'zoom-marker'

//==============================================================================

export type MarkerOptions = {
    color?: string
    scale?: number
    secondaryColor?: string
    text?: string
}

//==============================================================================

const CLUSTERED_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 27 42"
                                   width="calc(28 * {scale})" height="calc(39 * {scale})">
    <ellipse style="fill: rgb(0, 0, 0); fill-opacity: 0.2;" cx="12" cy="36" rx="8" ry="4"/>
    <path d="M12.25.25a12.254 12.254 0 0 0-12 12.494
             c0 6.444 6.488 12.109 11.059 22.564.549 1.256 1.333 1.256 1.882 0
             C17.762 24.853 24.25 19.186 24.25 12.744A12.254 12.254 0 0 0 12.25.25Z"
          style="fill:{color};stroke:{secondaryColor};stroke-width:1"/>
    <circle cx="12.5" cy="12.5" r="9" fill="{secondaryColor}"/>
    <text x="12" y="17.5" style="font-size:14px;fill:#000;text-anchor:middle">{text}</text>
</svg>`

const UNCLUSTERED_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 27 42"
                                     width="calc(28 * {scale})" height="calc(39 * {scale})">
    <ellipse style="fill: rgb(0, 0, 0); fill-opacity: 0.2;" cx="12" cy="36" rx="8" ry="4"/>
    <path d="M12.25.25a12.254 12.254 0 0 0-12 12.494
             c0 6.444 6.488 12.109 11.059 22.564.549 1.256 1.333 1.256 1.882 0
             C17.762 24.853 24.25 19.186 24.25 12.744A12.254 12.254 0 0 0 12.25.25Z"
          style="fill:{color};stroke:{secondaryColor};stroke-width:1"/>
    <circle cx="12.5" cy="12.5" r="5" fill="{secondaryColor}"/>
</svg>`

//==============================================================================

type MarkerIconDefinition = {
    id: string
    svg: string
    options?: MarkerOptions
}

const markerIconDefinitions: MarkerIconDefinition[] = [
    {
        id: CLUSTERED_MARKER_ID,
        svg: CLUSTERED_MARKER_SVG,
        options: {
            color: '#EE5900',
            secondaryColor: '#fff'
        }
    },
    {
        id: UNCLUSTERED_MARKER_ID,
        svg: UNCLUSTERED_MARKER_SVG,
        options: {
            color: '##005974',
            secondaryColor: '#fff'
        }
    },
]

//==============================================================================

export async function loadMarkerIcons(map: MapLibreMap)
//=====================================================
{
    // See https://github.com/rbrundritt/maplibre-gl-svg/blob/main/docs/docs.md

    for (const definition of markerIconDefinitions) {
        SvgTemplateManager.addTemplate(`${definition.id}-template`, definition.svg, false)
    }

    const svgManager = new SvgManager(map)
    for (const definition of markerIconDefinitions) {
        const options = definition.options || {}
        await svgManager.createFromTemplate(definition.id, `${definition.id}-template`, options.color, options.secondaryColor, options.scale, options.text)
    }
}

export function getMarkerElement(markerId: string, options: MarkerOptions={}): HTMLElement
//========================================================================================
{
    return SvgTemplateManager.getElement(`${markerId}-template`, options.text, options.color, options.secondaryColor, options.scale)
}

//==============================================================================

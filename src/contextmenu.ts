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

import type * as maplibregl from 'maplibre-gl'

//==============================================================================

import type { FlatMap } from './flatmap'

//==============================================================================

export type MenuItem = {
    action: () => void
    id: string
    prompt: string
} | string

//==============================================================================

function domContextMenu(items: MenuItem[], _title: string): HTMLElement
{
    const menuElement = document.createElement('ul')
    menuElement.className = 'flatmap-contextmenu'
    menuElement.setAttribute('type', 'context')

    for (const item of items) {
        if (item === '-') {
            menuElement.appendChild(document.createElement('hr'))
        } else if (typeof item === 'object') {
            const menuItem = document.createElement('li')
            menuItem.className = 'flatmap-contextmenu-item'
            menuItem.setAttribute('id', item.id)
            menuItem.onclick = item.action
            menuItem.textContent = item.prompt
            menuElement.appendChild(menuItem)
        }
    }
    return menuElement
}

/*
<ul>
  <li>prompt</li>
  <li>item 2</li>
</ul>
*/

//==============================================================================

export class ContextMenu
{
    #closeCallback
    #map: maplibregl.Map
    #popup: maplibregl.Popup

    constructor(flatmap: FlatMap, closeCallback)
    {
        this.#map = flatmap.map
        this.#closeCallback = closeCallback
        this.#popup = new maplibregl.Popup({
            closeButton: true,
            closeOnClick: true,
            className: 'flatmap-contextmenu-popup',
            maxWidth: 'none'
        })
        this.#popup.on('close', this.popupClose_.bind(this))
    }

    hide()
    //====
    {
        this.#popup.remove()
    }

    popupClose_(_e)
    //=============
    {
        this.#closeCallback()
    }

    show(position: maplibregl.LngLatLike, menuItems: MenuItem[], title: string)
    //=========================================================================
    {
        this.#popup.setLngLat(position)
        this.#popup.setDOMContent(domContextMenu(menuItems, title))
        this.#popup.addTo(this.#map)
    }
}

//==============================================================================

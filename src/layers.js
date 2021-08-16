/******************************************************************************

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

******************************************************************************/

'use strict';

//==============================================================================

import {PATHWAY_LAYERS} from './pathways.js';

import * as style from './styling.js';
import * as utils from './utils.js';

//==============================================================================

class MapFeatureLayer
{
    constructor(flatmap, layer, colourOn=true)
    {
        this._map = flatmap.map;
        this._id = layer.id;
        this.__featureBorderLayerIds = [];
        this.__featureFillLayerIds = [];
        this.__imageLayerIds = [];
        this.__styleLayerIds = [];

        const haveVectorLayers = (typeof this._map.getSource('vector-tiles') !== 'undefined');
        if (haveVectorLayers) {
            this.addStyleLayer_(style.BodyLayer.style);
        }
        if (flatmap.details['image_layer']) {
            for (const raster_layer_id of layer['image-layers']) {
                const layerId = this.addRasterLayer_(raster_layer_id, colourOn);
            }
        }
        // if no image layers then make feature borders (and lines?) more visible...??
        if (haveVectorLayers) {
            const fillLayerId = this.addStyleLayer_(style.FeatureFillLayer.style,
                    'features', colourOn);
            if (fillLayerId) {
                this.__featureFillLayerIds.push(fillLayerId)
            }
            this.addStyleLayer_(style.FeatureLineLayer.style);
            const borderLayerId = this.addStyleLayer_(style.FeatureBorderLayer.style,
                    'features', colourOn);
            if (borderLayerId) {
                this.__featureBorderLayerIds.push(borderLayerId);
            }
            this.addPathwayStyleLayers_();
            this.addStyleLayer_(style.FeatureLargeSymbolLayer.style);
            if (!flatmap.options.tooltips) {
                this.addStyleLayer_(style.FeatureSmallSymbolLayer.style);
            }
        }
    }

    get id()
    //======
    {
        return this._id;
    }

    addRasterLayer_(raster_layer_id, visible=true)
    //============================================
    {
        const styleLayer = style.RasterLayer.style(raster_layer_id, visible);
        if (styleLayer) {
            this._map.addLayer(styleLayer);
            this.__imageLayerIds.push(styleLayer.id);
            this.__styleLayerIds.push(styleLayer.id);
            return styleLayer.id;
        }
        return null;
    }

    addPathwayStyleLayers_()
    //======================
    {
        for (const pathLayer of PATHWAY_LAYERS) {
            if (this._map.getSource('vector-tiles')
                    .vectorLayerIds
                    .indexOf(pathLayer) >= 0) {
                this.addStyleLayer_(style.PathLineLayer.style, pathLayer);
                this.addStyleLayer_(style.PathDashlineLayer.style, pathLayer);
                this.addStyleLayer_(style.NervePolygonBorder.style, pathLayer);
                this.addStyleLayer_(style.NervePolygonFill.style, pathLayer);
                this.addStyleLayer_(style.FeatureNerveLayer.style, pathLayer);
            }
        }
    }

    addStyleLayer_(styleFunction, sourceLayer='features', ...args)
    //============================================================
    {
        const styleLayer = styleFunction(this._id, sourceLayer, ...args);
        if (styleLayer) {
            this._map.addLayer(styleLayer);
            this.__styleLayerIds.push(styleLayer.id);
            return styleLayer.id;
        }
        return null;
    }

    move(beforeLayer)
    //===============
    {
        const beforeTopStyleLayerId = beforeLayer ? beforeLayer.topStyleLayerId : undefined;
        for (const styleLayerId of this.__styleLayerIds) {
            this._map.moveLayer(styleLayerId, beforeTopStyleLayerId);
        }
    }

    setColour(colourOn=true)
    //======================
    {
        for (const layerId of this.__imageLayerIds) {
            this._map.setLayoutProperty(layerId, 'visibility', colourOn ? 'visible' : 'none');
        }
        for (const layerId of this.__featureFillLayerIds) {
            const paintStyle = style.FeatureFillLayer.paintStyle(colourOn);
            for (const [property, value] of Object.entries(paintStyle)) {
                this._map.setPaintProperty(layerId, property, value);
            }
        }
        for (const layerId of this.__featureBorderLayerIds) {
            const paintStyle = style.FeatureBorderLayer.paintStyle(colourOn);
            for (const [property, value] of Object.entries(paintStyle)) {
                this._map.setPaintProperty(layerId, property, value);
            }
        }
    }
}

//==============================================================================

export class LayerManager
{
    constructor(flatmap, switcher=false)
    {
        this._flatmap = flatmap;
        this._map = flatmap.map;
        this._layers = new Map;
        this._mapLayers = new Map;
        this._activeLayers = [];
        this._activeLayerNames = [];
        this._selectableLayerId = '';
        this._selectableLayerCount = 0;
        if ('background' in flatmap.options) {
            this._map.addLayer(style.BackgroundLayer.style(flatmap.options.background));
        } else {
            this._map.addLayer(style.BackgroundLayer.style('white'));
        }
    }

    get activeLayerNames()
    //====================
    {
        return this._activeLayerNames;
    }

    addLayer(layer)
    //=============
    {
        this._mapLayers.set(layer.id, layer);

        const layers = new MapFeatureLayer(this._flatmap, layer);
        const layerId = this._flatmap.mapLayerId(layer.id);
        this._layers.set(layerId, layers);

        if (layer.selectable) {
            this._selectableLayerId = layerId;
            this._selectableLayerCount += 1;
        }
    }

    get layers()
    //==========
    {
        return this._layers;
    }

    get selectableLayerCount()
    //========================
    {
        return this._selectableLayerCount;
    }

    get lastSelectableLayerId()
    //=========================
    {
        return this._selectableLayerId;
    }

    layerQueryable(layerName)
    //========================
    {
        const layer = this._mapLayers.get(layerName);
        return layer['queryable-nodes'];
    }

    activate(layerId)
    //===============
    {
        const layer = this._layers.get(layerId);
        if (layer !== undefined) {
            layer.activate();
            if (this._activeLayers.indexOf(layer) < 0) {
                this._activeLayers.push(layer);
                this._activeLayerNames.push(layer.id);
            }
        }
    }

    deactivate(layerId)
    //=================
    {
        const layer = this._layers.get(layerId);
        if (layer !== undefined) {
            layer.deactivate();
            const index = this._activeLayers.indexOf(layer);
            if (index >= 0) {
                delete this._activeLayers[index];
                this._activeLayers.splice(index, 1);
                delete this._activeLayerNames[index];
                this._activeLayerNames.splice(index, 1);
            }
        }
    }

    setColour(colourOn=true)
    //======================
    {
        for (const layer of this._layers.values()) {
            layer.setColour(colourOn)
        }
    }

    makeUppermost(layerId)
    //====================
    {
        // position before top layer
    }

    makeLowest(layerId)
    //=================
    {
        // position after bottom layer (before == undefined)
    }


    lower(layerId)
    //============
    {
        // position before second layer underneath...
    }

    raise(layerId)
    //============
    {
        // position before layer above...
    }
}

//==============================================================================

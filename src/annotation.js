/******************************************************************************

Flatmap viewer and annotation tool

Copyright (c) 2019 - 2023  David Brooks

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

// We use Font Awesome icons
import '../static/css/font-awesome.min.css';


import escape from 'html-es6cape';

import { jsPanel } from 'jspanel4';
import 'jspanel4/dist/jspanel.css';

//==============================================================================


/**
 * Based on ~/Flatmaps/ol-viewer/src/annotation.js
 */

//==============================================================================

const DISPLAY_PROPERTIES = {
	'id': 'Feature',
	'label': 'Tooltip',
	'models': 'Models',
	'name': 'Name',
	'sckan': 'SCKAN valid',
	'fc-class': 'FC class',
	'fc-kind': 'FC kind',
	'layer': 'Map layer',
}

const ANNOTATION_FIELDS = [
	{
		prompt: 'Feature derived from',
		key: 'prov:wasDerivedFrom',
		kind: 'list',
		size: 5
	},
	{
		prompt: 'Comment',
		key: 'rdfs:comment',
		kind: 'textbox'
	},
];


//==============================================================================

function inputFields(fieldDefinitions)
{
	const html = [];
	for (const field of fieldDefinitions) {
		if (!('input' in field) || field.input) {
			html.push('<div>');
			html.push(`  <label for="${field.key}">${field.prompt}:</label>`);
			if (field.kind === 'textbox') {
				html.push(`  <textarea rows="5" cols="40" id="${field.key}" name="${field.key}"></textarea>`)
			} else if (!('size' in field) || field.size === 1) {
				html.push(`  <input type="text" size="40" id="${field.key}" name="${field.key}"/>`)
			} else {
				html.push('  <div class="multiple">')
				for (let n = 1; n <= field.size; n++) {
					html.push(`    <input type="text" size="40" id="${field.key}_${n}" name="${field.key}"/>`)
				}
				html.push('  </div>')
			}
			html.push('</div>');
		}
	}
	return html.join('\n');
}

//==============================================================================

export class Annotator
{
	constructor(flatmap)
	{
		this.__flatmap = flatmap;
	}

    async getExternalAnnotation(featureId)
    {
        const url = this.__flatmap.addBaseUrl_(`/annotations/${featureId}`);
        fetch(url, {
            method: 'GET',
            headers: {
                "Accept": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            }
        }).then((response) => {
            if (!response.ok) {
                throw new Error(`Cannot access ${url}, Status: ${response.status}`);
            }
            return response.json();
        });
    }

    async saveExternalAnnotation(featureId, properties)
    //=================================================
    {
        const url = this.__flatmap.addBaseUrl_(`/annotations/${featureId}`);
        fetch(url, {
            headers: { "Content-Type": "application/json; charset=utf-8" },
            method: 'POST',
            body: JSON.stringify(properties)
        }).then((response) => {
            if (!response.ok) {
                throw new Error(`HTTP error ${url}, Status: ${response.status}`);
            }
            return response.text();
        });
    }


	annotate(feature, closedCallback)
	{
		const featureId = feature.properties['id']

        if (featureId === undefined) {
        	closedCallback();
        	return;
        }


/**
    contentFetch: {
        resource: this.__flatmap.addBaseUrl_(`/annotations/${featureId}`),
        beforeSend: (fetchConfig, panel) => {
            panel.headerlogo.innerHTML = "<span class='fad fa-spinner fa-spin ml-2'></span>"
        },
        fetchInit: {
            method: 'POST'
        },
        done: (response, panel) => {
            panel.content.innerHTML = response;
            panel.headerlogo.innerHTML = "<span class='fad fa-check ml-2'></span>";
            panel.resize('auto 300').reposition();
        }
    }
**/
    	// Historical annotation
    	const savedAnnotations = [  // *******await this.__flatmp.getExternalAnnotation(featureId);
    		                        // But are we in this format???
	    	{
	    		created: 'Today...',
	    		creator: "dave",
	    		properties: [
		    		{
		    			'rdfs:comment': 'Some comment'
		    		}
	    		]
	    	},
	    	{
	    		created: 'Yesterday...',
	    		creator: "dave",
	    		properties: [
		    		{
		    			'rdfs:comment': 'Some other comment'
		    		}
	    		]
	    	}
	    ];


    	const html = ['<div class="flatmap-annotation-panel">'];

    	// Feature properties
		html.push('  <div class="flatmap-annotation-feature">');
    	for (const [key, prompt] of Object.entries(DISPLAY_PROPERTIES)) {
    		const value = feature.properties[key];
    		if (value !== undefined && value !== '') {
    			const escapedValue = escape(value).replaceAll('\n', '<br/>');
    			html.push(`    <div><span class="flatmap-annotation-prompt">${prompt}:</span><span class="flatmap-annotation-value">${escapedValue}</span></div>`)
    		}
    	}
		html.push('  </div>');

    	// Entry fields
    	// But only when logged in...
    	// And then derived from values are set to latest historical...
		html.push('  <form id="flatmap-annotation-form" class="flatmap-annotation-form">');
		html.push('    <div class="flatmap-annotation-data">');
		html.push(inputFields(ANNOTATION_FIELDS));
		html.push('      <div><input type="button" value="Save"/></div>');
		html.push('    </div>');
		html.push('  </form>');


    	let firstBlock = true;
    	html.push('  <div class="flatmap-annotation-historical">');
    	for (const annotation of savedAnnotations) {
    		if (firstBlock) {
    			firstBlock = false;
    		} else {
    			html.push('<hr/>')
    		}
    		html.push(`    <div><span class="flatmap-annotation-prompt">${annotation.created}</span><span class="flatmap-annotation-value">${annotation.creator}</span></div>`)
			for (const property of annotation.properties) {
				for (const field of ANNOTATION_FIELDS) {
					const value = property[field.key];
	    			if (value !== undefined && value !== '') {
	    				html.push(`    <div><span class="flatmap-annotation-prompt">${field.prompt}:</span><span class="flatmap-annotation-value">${escape(value)}</span></div>`)
	    			}
	    		}
    		}
    	}
    	html.push('  </div>');
    	html.push('</div>');

		const dialog = jsPanel.create({
		    theme: 'light',
		    border: '2px solid #C00',
		    borderRadius: '.5rem',
		    panelSize: '470px auto',
		    content: html.join('\n'),
 			closeOnEscape: true,
		    closeOnBackdrop: false,
			headerTitle: 'Feature annotations',
			headerControls: 'closeonly xs',
		    footerToolbar: [
		        '<span id="flatmap-annotation-user" class="flex-auto">Logged out</span>',
		        '<span id="flatmap-annotation-lock" class="jsPanel-ftr-btn fa fa-lock"></span>',
		    ],
		    callback: (panel) => {
		        // Data entry only when authorised
		        const annotationForm = document.getElementById('flatmap-annotation-form');
		        annotationForm.hidden = true;

		        const authoriseLock = document.getElementById('flatmap-annotation-lock');
		        const authorisedUser = document.getElementById('flatmap-annotation-user');
		        const lockClasses = authoriseLock.classList
		        authoriseLock.addEventListener('click', (e) => {
		        	if (lockClasses.contains('fa-lock')) {
		        		lockClasses.remove('fa-lock');
		        		lockClasses.add('fa-unlock');
		        		// '/login`
		        		authorisedUser.innerHTML = 'Logged in user...';
		        		annotationForm.hidden = false;
		        	} else {
		        		lockClasses.remove('fa-unlock');
		        		lockClasses.add('fa-lock');
		        		authorisedUser.innerHTML = 'Logged out';
		        		annotationForm.hidden = true;
		        	}
		        });

		        // get all focusable elements within the panel content
		        const focusableElmts = panel.content.querySelectorAll('input, button');
		        const first = focusableElmts[0];
		        const last  = focusableElmts[focusableElmts.length - 1];
		        // focus first focusable element
		        first.focus();
		        // handler to lock focus within the panel
		        panel.addEventListener('keydown', function (e) {
		            if (e.key === 'Tab') {
		                if ( e.shiftKey ) /* shift + tab */ {
		                    if (document.activeElement === first) {
		                        last.focus();
		                        e.preventDefault();
		                    }
		                } else /* tab */ {
		                    if (document.activeElement === last) {
		                        first.focus();
		                        e.preventDefault();
		                    }
		                }
		            } else if (e.key === 'Enter') {
		            	if (e.target === last) {
			            	// validate/save input and close dialog
		            		panel.close();
		            	}
		            }
		        });

		        // want handler just on the form's  buttons
		        panel.addEventListener('mousedown', function (e) {
		            	if (e.target === last) {
			            	// validate/save input and close dialog
		            		panel.close();
		            	}
		        	// submit button event...
		        });

		        document.addEventListener('jspanelclosed', closedCallback, false);
		    }
		});

    /// *******await this.__flatmp.saveExternalAnnotation(featureId, properties);

	}


}

//==============================================================================

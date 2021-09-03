import { MapManager } from './flatmap-viewer';

const DEBUG = false;
const MINIMAP = true; // { width: '10%', background: '#FCC' };

//const MAP_ENDPOINT = 'https://mapcore-demo.org/flatmaps/';
const MAP_ENDPOINT = 'http:localhost:8000/';
//const MAP_ENDPOINT = 'https://mapcore-demo.org/devel/flatmap/v1/';


const RAT_STATE = {
    center: [
        -7.242321307849636,
         1.2996755426731852
    ],
    zoom: 6.962151361047079
};

//==============================================================================

window.onload = async function() {
    const mapManager = new MapManager(MAP_ENDPOINT, {
        images: [
            {
                id: 'label-background',
                url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC8AAAAmCAIAAADbSlUzAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAJOgAACToAYJjBRwAAACVSURBVFhH7dixDoJAEIThfXqMBcYKrTQ+jkYSStDYkVhZINxyEshJcZXJtC7FfNlmur9eyXb7Vqf6+bI9HUKyWkt5e4RlOF9ycerjsqbqpfefuKzNJawBWIOxBmMNxhqMNRhrMNZgrMFYg7EGYw3GGow1GGuw5dU07y4ua22nUlb3uKxd80IOx1Pjxp+f4P/P+ZButl+YrbXnPs+YmAAAAABJRU5ErkJggg==',
                options: {
                    content: [21, 4, 28, 33],
                    stretchX: [[21, 28]],
                    stretchY: [[4, 33]]
                }
            }
        ]
    });

    const maps = await mapManager.allMaps();

    const viewerUrl = new URL(document.URL);
    const viewMapId = viewerUrl.searchParams.get('map');

    let mapId = null;
    const options = [];
    const selector = document.getElementById('map-selector');
    for (const map of Object.values(maps)) {
        const text = [];
        if ('describes' in map) {
            text.push(map.describes);
        }
        let sortKey = '';
        if ('created' in map) {
            text.push(map.created);
            sortKey = map.created;
        }
        text.push(map.id);

        let selected = '';
        if (map.id === viewMapId) {
            mapId = map.id;
            selected = 'selected';
        }
        options.push({
            option: `<option value="${map.id}" ${selected}>${text.join(' -- ')}</option>`,
            sortKey: sortKey
        });
    }
    selector.innerHTML = options.sort((a, b) => (a.sortKey < b.sortKey) ?  1
                                              : (a.sortKey > b.sortKey) ? -1
                                              : 0)
                                .map(o => o.option).join('');

    if (mapId === null) {
        mapId = selector.options[0].value;
        selector.options[0].selected = true;
    }

    let currentMap = null;

    function markerPopupContent()
    {
        const element = document.createElement('div');

        element.innerHTML = `<button data-v-6e7795b6="" type="button" class="el-button button el-button--default is-round">
    <span>View 3D scaffold</span>
</button>
<br/>
<button data-v-6e7795b6="" type="button" class="el-button button el-button--default is-round" id="popover-button-1">
    <span>Search for datasets</span>
</button>`;

        return element;
    }

    let nextColour = '#FF0';

    function callback(event, options)
    {
        console.log(event, options);
        return;
    }

    const loadMap = (id) => {
        if (currentMap !== null) {
            currentMap.close();
        }

        viewerUrl.searchParams.set('map', id);
        window.history.pushState('data', document.title, viewerUrl);

        mapManager.loadMap(id, 'map-canvas', (event, options) => callback(event, options), {
            tooltips: true,
            background: '#EEF',
            debug: DEBUG,
            minimap: MINIMAP,
            navigationControl: 'top-right',
            searchable: true,
            featureInfo: true
        }).then(map => {
            map.addMarker('UBERON:0000948'); // Heart
            map.addMarker('UBERON:0002048'); // Lung
            map.addMarker('UBERON:0000945'); // Stomach
            map.addMarker('UBERON:0001155'); // Colon
            map.addMarker('UBERON:0001255'); // Bladder
            if (id == 'whole-rat') {
                //map.setState(RAT_STATE);
                map.zoomTo(['UBERON:945', 'UBERON:1255']);
                console.log(map.anatomicalIdentifiers);
            }
            currentMap = map;
        });
    };

    selector.onchange = (e) => loadMap(e.target.value);

    loadMap(mapId);
};

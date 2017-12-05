const paper = spritejs.Paper2D('#paper')
paper.setResolution(1800, 1000) 

const worldLayer = paper.layer('world-layer', {
  //resolution: [3600, 2000], 
  handleEvent: false
})
const mapLayer = paper.layer('map-layer')


function mapTransform(layer, matrix, update = true) {
  const [width, height] = layer.resolution
  //console.log(translate)
  layer.adjust(context => {
    context.restore()
    context.save()
    context.transform(...matrix)
    //context.translate(width / 2, height / 2)
    //context.scale(scale, scale)
    //context.translate(-width / 2, -height / 2)
  }, update)
}

const MapLoader = {
  cache: {},
  load(mapId) {
    const cached = this.cache[mapId]
    if(cached) {
      return Promise.resolve(cached)
    }

    const mapPath = `/static/mapData/${mapId}.json`
    return new Promise((resolve, reject) => {
      d3.json(mapPath, (err, data) => {
        if(err){
          reject(err)
          return
        }
        data.id = String(mapId)
        this.cache[mapId] = data
        resolve(data)
      })
    }) 
  }
}

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

const ChinaMapID = 1

class World {
  constructor(layer) {
    this.layer = layer
    this.transitionMap = {}
  }
  async load(mapId) {
    const parentId = mapRelation[mapId].parentId

    this.mapId = mapId
    this.parentId = parentId

    const map = await MapLoader.load(mapId)

    let baseScale = 1

    const srcSize = mapRelation[mapId].size

    if(mapId != ChinaMapID) {
      //相对于中国地图缩放
      const desSize = mapRelation[ChinaMapID].size

      baseScale = Math.min(desSize[0] / srcSize[0], desSize[1] / srcSize[1])
    }
    this.baseScale = baseScale

    this.map = map
    
    if(!map.cp) {
      map.cp = mapRelation[mapId].boxCP
    }

    this.metaData = {
      [mapId]: {id: mapId, name: mapRelation[mapId].name, cp: map.cp, size: srcSize}
    }

    for(let feature of map.features) {
      let {id, name, cp} = feature.properties
      if(!cp) {
        cp = mapRelation[id].boxCP
      }
      this.metaData[id] = {id, name, cp, size: mapRelation[id].size}
    }

    //this.baseScale = 1
    await this.draw()
  }
  async draw() {
    const layer = this.layer
    
    const [width, height] = layer.resolution
    
    const projection = d3.geoMercator()
      .center(this.metaData[this.mapId].cp)
      .translate([width / 2, height / 2])
      .scale(this.baseScale * width / 2)    

    this.projection = projection

    const path = d3.geoPath().projection(projection)

    let parentId = this.parentId,
      parents = new Set()

    while(parentId != null) {
      parents.add(parentId)
      parentId = mapRelation[parentId] && mapRelation[parentId].parentId
    }

    let superMaps = await Promise.all([...parents].reverse().map(parentId => MapLoader.load(parentId)))
    superMaps = superMaps.reduce((fetures, map) => fetures.concat(map.features), [])

    let features = [...superMaps, ...this.map.features]

    //把不在显示区附近的地图给过滤掉
    const filted = features.filter(feature => {
      //console.log(path.bounds(feature))
      //if(pos[0] )
      const [topLeft, rightBottom] = path.bounds(feature)
      const size = [rightBottom[0] - topLeft[0], rightBottom[1] - topLeft[1]]
      const mapCenter = [width / 2, height / 2]
      const regionCenter = path.centroid(feature)

      return Math.abs(regionCenter[0] - mapCenter[0]) <= (size[0] + width) / 2
      && Math.abs(regionCenter[1] - mapCenter[1]) <= (size[1] + height) / 2
    })

    const mapId = this.mapId

    mapTransform(layer, [1, 0, 0, 1, 0, 0], false)
    layer.remove()

    d3.select(layer).selectAll('path')
      .data(filted)
      .enter()
      .append('path')
      .attr('d', path)
      .attr('renderMode', 'fill')
      .select(function(data) {
        const parentMeta = mapRelation[data.properties.id]

        if(parentMeta && mapId == parentMeta.parentId) {
          //this.attr('lineWidth', 3)
          this.attr('zIndex', 10)
          this.attr('fillColor', 'transparent')
        } else {
          this.attr('strokeColor', 'rgba(0,0,0,0.3)')
          this.attr('fillColor', '#d1eeee')
        }
        this.id = data.properties.id
        this.name = data.properties.name
        return this
      })
      .exit()

    this.layer = layer
  }
  getPath(destId) {
    let id = this.mapId
    let sources = [id + '']

    while(mapRelation[id] && mapRelation[id].parentId) {
      id = mapRelation[id].parentId
      sources.push(id)
    }
    let des = [destId + '']
    id = destId
    while(mapRelation[id] && mapRelation[id].parentId) {
      id = mapRelation[id].parentId
      const idx = sources.indexOf(id)

      if(idx >= 0){
        sources = sources.slice(0, idx + 1)
        break
      }
      des.unshift(id)
    }
    sources.pop()
    return {leave: sources, enter: des}
  }
  async moveTo(id) {
    if(id != this.mapId){
      const {leave, enter} = this.getPath(id) //获取跳转路径
      console.log(leave, enter)
      for(let step of leave) {
        await this.leave(step)
        await sleep(500)
      }
      for(let step of enter) {
        await this.enter(step)
        await sleep(500)
      }
    }
  }
  async enter(subId, duration = 1000) {
    const mapId = mapRelation[subId].parentId
    if(!mapId) return

    if(mapId != this.mapId) {
      await this.load(mapId)
    }

    const layer = this.layer,
          features = this.map.features

    d3.select(layer).selectAll('path')
      .attr('fillColor', '#d1eeee')
      .attr('lineWidth', 1)
      .attr('strokeColor', 'rgba(0, 0, 0, 0.3)')
      .attr('zIndex', 0)

    d3.select(layer)
      .select('#' + subId)
      //.attr('fillColor', 'white')
      .attr('strokeColor', 'black')
      .attr('lineWidth', 1)
      .attr('zIndex', 100)

    let desMatrix = this.transitionMap[subId]

    if(!desMatrix) {
      let subMeta = this.metaData[subId]

      const pos = this.projection(subMeta.cp)
      
      const desSize = mapRelation[ChinaMapID].size
      const scale = Math.min(desSize[0] / subMeta.size[0], 
            desSize[1] / subMeta.size[1]) / this.baseScale

      const translate = this.projection.translate()
      
      const srcMatrix = [1, 0, 0, 1, 0, 0]

      desMatrix = [scale, 0, 0, scale, 
        translate[0] - pos[0] * scale, 
        translate[1] - pos[1] * scale]

      this.transitionMap[subId] = desMatrix
    }

    const animator = new Animator(duration,  function(p){
      const matrix = [
        1 + (desMatrix[0] - 1) * p, 0, 0,
        1 + (desMatrix[3] - 1) * p, 
        desMatrix[4] * p,
        desMatrix[5] * p
      ]

      mapTransform(layer, matrix)
    })

    await animator.animate()
    await sleep(10)
    await this.load(subId)
  }
  async leave(subId, duration = 1000) {
    const parentId = this.parentId
    if(!parentId) return

    await this.load(parentId)

    const layer = this.layer,
          features = this.map.features

    d3.select(layer).selectAll('path')
      .attr('fillColor', '#d1eeee')
      .attr('lineWidth', 1)
      .attr('zIndex', 0)

    const matrix = this.transitionMap[subId]

    if(matrix) {

      const animator = new Animator(duration,  function(p){
        const m = [
          matrix[0] + (1 - matrix[0]) * p, 0, 0,
          matrix[3] + (1 - matrix[3]) * p, 
          matrix[4] * (1 - p),
          matrix[5] * (1 - p)
        ]

        mapTransform(layer, m)
      })

      await animator.animate()
    }
    
    await sleep(10)
    await this.load(parentId)
  }
}

(async function() {
  const world = new World(worldLayer)
  await world.load(1)
  //world.enter(2205)
  window.world = world

  moveToForm.onsubmit = function(evt) {
    const value = moveToText.value || 1
    world.moveTo(value)
    evt.preventDefault()
  }
})()

window.addEventListener('resize', evt => {
  paper.setViewport('auto', 'auto')
})
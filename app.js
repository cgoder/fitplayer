/**
 * Runback - 运动轨迹回放
 * 基于 comparison_player.js 原型重构
 */

// ========================================
// CoordTransform - WGS-84 到 GCJ-02 坐标转换
// 用于修正中国地图（高德、百度等）的坐标偏移
// ========================================
const CoordTransform = {
    // 常量
    PI: Math.PI,
    X_PI: Math.PI * 3000.0 / 180.0,
    A: 6378245.0, // 长半轴
    EE: 0.00669342162296594323, // 偏心率平方

    /**
     * 判断坐标是否在中国境内
     */
    outOfChina(lng, lat) {
        return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
    },

    /**
     * 转换纬度
     */
    transformLat(lng, lat) {
        let ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat +
            0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
        ret += (20.0 * Math.sin(6.0 * lng * this.PI) + 20.0 * Math.sin(2.0 * lng * this.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(lat * this.PI) + 40.0 * Math.sin(lat / 3.0 * this.PI)) * 2.0 / 3.0;
        ret += (160.0 * Math.sin(lat / 12.0 * this.PI) + 320 * Math.sin(lat * this.PI / 30.0)) * 2.0 / 3.0;
        return ret;
    },

    /**
     * 转换经度
     */
    transformLng(lng, lat) {
        let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng +
            0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
        ret += (20.0 * Math.sin(6.0 * lng * this.PI) + 20.0 * Math.sin(2.0 * lng * this.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(lng * this.PI) + 40.0 * Math.sin(lng / 3.0 * this.PI)) * 2.0 / 3.0;
        ret += (150.0 * Math.sin(lng / 12.0 * this.PI) + 300.0 * Math.sin(lng / 30.0 * this.PI)) * 2.0 / 3.0;
        return ret;
    },

    /**
     * WGS-84 转 GCJ-02 (火星坐标系)
     * @param {number} wgsLng WGS-84 经度
     * @param {number} wgsLat WGS-84 纬度
     * @returns {Object} {lng, lat} GCJ-02 坐标
     */
    wgs84ToGcj02(wgsLng, wgsLat) {
        if (this.outOfChina(wgsLng, wgsLat)) {
            return { lng: wgsLng, lat: wgsLat };
        }

        let dLat = this.transformLat(wgsLng - 105.0, wgsLat - 35.0);
        let dLng = this.transformLng(wgsLng - 105.0, wgsLat - 35.0);
        const radLat = wgsLat / 180.0 * this.PI;
        let magic = Math.sin(radLat);
        magic = 1 - this.EE * magic * magic;
        const sqrtMagic = Math.sqrt(magic);
        dLat = (dLat * 180.0) / ((this.A * (1 - this.EE)) / (magic * sqrtMagic) * this.PI);
        dLng = (dLng * 180.0) / (this.A / sqrtMagic * Math.cos(radLat) * this.PI);

        return {
            lng: wgsLng + dLng,
            lat: wgsLat + dLat
        };
    }
};
// ========================================
// Theme Manager - 主题管理器
// ========================================
class ThemeManager {
    constructor() {
        this.theme = localStorage.getItem('fit-player-theme') || 'light';
        this.toggleBtn = document.getElementById('theme-toggle');
        this.init();
    }

    init() {
        this.applyTheme(this.theme);
        this.toggleBtn.addEventListener('click', () => this.toggle());
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const icon = this.toggleBtn.querySelector('i');
        if (theme === 'dark') {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        } else {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
        }
        localStorage.setItem('fit-player-theme', theme);
    }

    toggle() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        this.applyTheme(this.theme);
    }
}

// ========================================
// FIT Parser - FIT 文件解析器 (原生实现)
// ========================================
class FitParser {
    constructor() {
        // FIT 文件常量
        this.SEMICIRCLES_TO_DEGREES = 180 / Math.pow(2, 31);

        // FIT 消息类型
        this.MESG_NUM = {
            FILE_ID: 0,
            SESSION: 18,
            LAP: 19,
            RECORD: 20,
            EVENT: 21,
            ACTIVITY: 34,
        };

        // 基准时间戳 (1989-12-31 00:00:00 UTC)
        this.FIT_EPOCH = 631065600000;
    }

    async parse(arrayBuffer) {
        try {
            const dataView = new DataView(arrayBuffer);
            const records = [];
            let offset = 0;

            // 解析文件头
            const headerSize = dataView.getUint8(0);
            const protocolVersion = dataView.getUint8(1);
            const profileVersion = dataView.getUint16(2, true);
            const dataSize = dataView.getUint32(4, true);

            // 验证 FIT 标识
            const signature = String.fromCharCode(
                dataView.getUint8(8),
                dataView.getUint8(9),
                dataView.getUint8(10),
                dataView.getUint8(11)
            );

            if (signature !== '.FIT') {
                throw new Error('无效的 FIT 文件格式');
            }

            console.log('FIT Header:', { headerSize, protocolVersion, profileVersion, dataSize, signature });

            offset = headerSize;
            const endOffset = headerSize + dataSize;

            // 存储字段定义
            const definitions = {};

            // 解析数据记录
            while (offset < endOffset && offset < arrayBuffer.byteLength - 2) {
                try {
                    const recordHeader = dataView.getUint8(offset);
                    offset++;

                    // 检查是否是压缩时间戳头 (高位为1)
                    const isCompressedTimestamp = (recordHeader & 0x80) !== 0;

                    if (isCompressedTimestamp) {
                        // 压缩时间戳数据消息
                        const localMessageType = (recordHeader >> 5) & 0x03;
                        const definition = definitions[localMessageType];

                        if (definition) {
                            const record = this.parseDataRecord(dataView, offset, definition);
                            offset = record.newOffset;

                            if (definition.globalMessageNumber === this.MESG_NUM.RECORD) {
                                records.push(record.data);
                            }
                        }
                        continue;
                    }

                    const isDefinition = (recordHeader & 0x40) !== 0;
                    const hasDeveloperData = (recordHeader & 0x20) !== 0;
                    const localMessageType = recordHeader & 0x0F;

                    if (isDefinition) {
                        // 定义消息
                        offset++; // 保留字节
                        const architecture = dataView.getUint8(offset);
                        offset++;
                        const isLittleEndian = architecture === 0;

                        const globalMessageNumber = dataView.getUint16(offset, isLittleEndian);
                        offset += 2;

                        const numFields = dataView.getUint8(offset);
                        offset++;

                        const fields = [];
                        for (let i = 0; i < numFields; i++) {
                            fields.push({
                                fieldDefNum: dataView.getUint8(offset),
                                size: dataView.getUint8(offset + 1),
                                baseType: dataView.getUint8(offset + 2),
                            });
                            offset += 3;
                        }

                        // 处理开发者数据字段
                        let devFields = [];
                        if (hasDeveloperData) {
                            const numDevFields = dataView.getUint8(offset);
                            offset++;
                            for (let i = 0; i < numDevFields; i++) {
                                devFields.push({
                                    fieldNum: dataView.getUint8(offset),
                                    size: dataView.getUint8(offset + 1),
                                    devDataIndex: dataView.getUint8(offset + 2),
                                });
                                offset += 3;
                            }
                        }

                        definitions[localMessageType] = {
                            globalMessageNumber,
                            isLittleEndian,
                            fields,
                            devFields,
                        };
                    } else {
                        // 普通数据消息
                        const definition = definitions[localMessageType];
                        if (!definition) {
                            console.warn('未找到消息定义:', localMessageType);
                            continue;
                        }

                        const record = this.parseDataRecord(dataView, offset, definition);
                        offset = record.newOffset;

                        if (definition.globalMessageNumber === this.MESG_NUM.RECORD) {
                            records.push(record.data);
                        }
                    }
                } catch (e) {
                    console.warn('解析记录时出错:', e.message, 'offset:', offset);
                    offset++;
                }
            }

            console.log('Parsed records:', records.length);
            return this.processData({ records });

        } catch (error) {
            console.error('FIT 解析错误:', error);
            throw error;
        }
    }

    parseDataRecord(dataView, offset, definition) {
        const data = { messageType: definition.globalMessageNumber };
        let newOffset = offset;

        // 解析标准字段
        for (const field of definition.fields) {
            const value = this.readFieldValue(dataView, newOffset, field, definition.isLittleEndian);
            newOffset += field.size;

            // 解析 RECORD 消息中的字段
            if (definition.globalMessageNumber === this.MESG_NUM.RECORD) {
                switch (field.fieldDefNum) {
                    case 253: // timestamp
                        if (value !== null && value !== 0xFFFFFFFF) {
                            data.timestamp = new Date(this.FIT_EPOCH + value * 1000);
                        }
                        break;
                    case 0: // position_lat (sint32)
                        if (value !== null && value !== 0x7FFFFFFF && value !== -0x80000000) {
                            data.position_lat = value * this.SEMICIRCLES_TO_DEGREES;
                        }
                        break;
                    case 1: // position_long (sint32)
                        if (value !== null && value !== 0x7FFFFFFF && value !== -0x80000000) {
                            data.position_long = value * this.SEMICIRCLES_TO_DEGREES;
                        }
                        break;
                    case 2: // altitude (带偏移)
                        if (value !== null && value !== 0xFFFF) {
                            data.altitude = (value / 5) - 500;
                        }
                        break;
                    case 3: // heart_rate
                        if (value !== null && value !== 0xFF) {
                            data.heart_rate = value;
                        }
                        break;
                    case 4: // cadence
                        if (value !== null && value !== 0xFF) {
                            data.cadence = value;
                        }
                        break;
                    case 5: // distance (单位: 1/100 m)
                        if (value !== null && value !== 0xFFFFFFFF) {
                            data.distance = value / 100000; // 转换为 km
                        }
                        break;
                    case 6: // speed (单位: 1/1000 m/s)
                        if (value !== null && value !== 0xFFFF) {
                            data.speed = (value / 1000) * 3.6; // 转换为 km/h
                        }
                        break;
                    case 73: // enhanced_speed
                        if (value !== null && value !== 0xFFFFFFFF) {
                            data.speed = (value / 1000) * 3.6; // 转换为 km/h
                        }
                        break;
                    case 78: // enhanced_altitude
                        if (value !== null && value !== 0xFFFFFFFF) {
                            data.enhanced_altitude = (value / 5) - 500;
                        }
                        break;
                }
            }
        }

        // 跳过开发者数据字段
        if (definition.devFields) {
            for (const devField of definition.devFields) {
                newOffset += devField.size;
            }
        }

        return { data, newOffset };
    }

    readFieldValue(dataView, offset, field, isLittleEndian) {
        const baseType = field.baseType & 0x1F;

        try {
            // 确保不越界
            if (offset + field.size > dataView.byteLength) {
                return null;
            }

            switch (baseType) {
                case 0: // enum
                    return dataView.getUint8(offset);
                case 1: // sint8
                    return dataView.getInt8(offset);
                case 2: // uint8
                    return dataView.getUint8(offset);
                case 3: // sint16
                    return dataView.getInt16(offset, isLittleEndian);
                case 4: // uint16
                    return dataView.getUint16(offset, isLittleEndian);
                case 5: // sint32
                    return dataView.getInt32(offset, isLittleEndian);
                case 6: // uint32
                    return dataView.getUint32(offset, isLittleEndian);
                case 7: // string
                    // 读取字符串，直到遇到 null 终止符或达到字段大小
                    let str = '';
                    for (let i = 0; i < field.size; i++) {
                        const charCode = dataView.getUint8(offset + i);
                        if (charCode === 0) break; // Null terminator
                        str += String.fromCharCode(charCode);
                    }
                    return str;
                case 8: // float32
                    return dataView.getFloat32(offset, isLittleEndian);
                case 9: // float64
                    return dataView.getFloat64(offset, isLittleEndian);
                case 10: // uint8z
                    return dataView.getUint8(offset);
                case 11: // uint16z
                    return dataView.getUint16(offset, isLittleEndian);
                case 12: // uint32z
                    return dataView.getUint32(offset, isLittleEndian);
                case 13: // byte array
                    // 返回一个 Uint8Array
                    return new Uint8Array(dataView.buffer, offset, field.size);
                case 14: // sint64
                    // 读取为两个32位整数
                    const low = dataView.getUint32(offset, isLittleEndian);
                    const high = dataView.getInt32(offset + 4, isLittleEndian);
                    return isLittleEndian ? low + high * 0x100000000 : high * 0x100000000 + low;
                case 15: // uint64
                case 16: // uint64z
                    // 对于 JavaScript，64位整数可能超出安全整数范围，这里只读取低32位作为近似值
                    // 或者可以实现 BigInt 逻辑，但为了兼容性，暂时只取低位
                    return dataView.getUint32(offset, isLittleEndian);
                default:
                    return null;
            }
        } catch (e) {
            console.warn(`Error reading field value (baseType: ${baseType}, offset: ${offset}, size: ${field.size}):`, e.message);
            return null;
        }
    }

    processData(data) {
        const records = data.records || [];

        // 计算起始时间
        const startTime = records.find(r => r.timestamp)?.timestamp || new Date();

        // 提取有效的 GPS 记录
        const points = records
            .filter(r => r.position_lat !== undefined && r.position_long !== undefined)
            .filter(r => Math.abs(r.position_lat) <= 90 && Math.abs(r.position_long) <= 180) // 过滤无效坐标
            .map((r, index) => {
                // 计算 elapsed_time
                const elapsed_time = r.timestamp
                    ? (r.timestamp.getTime() - startTime.getTime()) / 1000
                    : index;

                // WGS-84 转 GCJ-02 (适配高德地图)
                const gcj02 = CoordTransform.wgs84ToGcj02(r.position_long, r.position_lat);

                return {
                    index,
                    lat: gcj02.lat,
                    lng: gcj02.lng,
                    // 保留原始 WGS-84 坐标用于调试
                    wgs84_lat: r.position_lat,
                    wgs84_lng: r.position_long,
                    timestamp: r.timestamp,
                    elapsed_time,
                    heart_rate: r.heart_rate,
                    speed: r.speed,
                    altitude: r.altitude || r.enhanced_altitude,
                    distance: r.distance,
                    cadence: r.cadence,
                };
            });

        console.log('Valid GPS points:', points.length);
        if (points.length > 0) {
            console.log('First point:', points[0]);
            console.log('Last point:', points[points.length - 1]);
        }

        // 计算总时长
        const totalSeconds = points.length > 0
            ? Math.max(...points.map(p => p.elapsed_time || 0))
            : 0;

        // 创建按秒索引的点数组
        const indexedPoints = this.createIndexedPoints(points, totalSeconds);

        return {
            points,
            indexedPoints,
            totalSeconds: Math.ceil(totalSeconds),
            startTime: points[0]?.timestamp,
            endTime: points[points.length - 1]?.timestamp,
            summary: {},
        };
    }

    createIndexedPoints(points, totalSeconds) {
        if (points.length === 0) return [];

        const indexed = [];
        let pointIndex = 0;

        for (let second = 0; second <= totalSeconds; second++) {
            // 找到最接近当前秒数的点
            while (pointIndex < points.length - 1 &&
                points[pointIndex + 1].elapsed_time <= second) {
                pointIndex++;
            }
            indexed[second] = points[pointIndex];
        }

        return indexed;
    }
}

// ========================================
// Map Renderer - 地图渲染器 (高德地图)
// ========================================
class MapRenderer {
    constructor(containerId) {
        this.containerId = containerId;
        this.map = null;
        this.polyline = null;
        this.marker = null;
        this.startMarker = null;
        this.endMarker = null;
        this.points = [];
    }

    async init() {
        return new Promise((resolve) => {
            const initMap = () => {
                // 检查高德地图是否加载
                if (typeof AMap === 'undefined') {
                    console.warn('AMap not loaded, map features will be limited');
                    resolve();
                    return;
                }

                this.map = new AMap.Map(this.containerId, {
                    zoom: 14,
                    center: [118.79, 32.06], // 默认南京
                    mapStyle: 'amap://styles/normal',
                });

                // 添加地图控件
                AMap.plugin(['AMap.ToolBar', 'AMap.Scale'], () => {
                    this.map.addControl(new AMap.Scale());
                });

                resolve();
            };

            // 如果 AMap 已加载，直接初始化
            if (typeof AMap !== 'undefined') {
                initMap();
            } else {
                // 否则等待 AMapLoaded 事件
                window.addEventListener('AMapLoaded', initMap, { once: true });
                // 设置超时（10秒后放弃等待）
                setTimeout(() => {
                    if (typeof AMap === 'undefined') {
                        console.error('AMap API loading timeout');
                        resolve();
                    }
                }, 10000);
            }
        });
    }

    drawTrack(points) {
        if (!this.map || points.length === 0) return;

        this.points = points;

        // 转换坐标
        const path = points.map(p => [p.lng, p.lat]);

        // 清除旧的轨迹
        if (this.polyline) {
            this.map.remove(this.polyline);
        }

        // 绘制轨迹线
        this.polyline = new AMap.Polyline({
            path: path,
            strokeColor: '#3b82f6',
            strokeWeight: 4,
            strokeOpacity: 0.8,
            lineJoin: 'round',
            lineCap: 'round',
        });
        this.map.add(this.polyline);

        // 添加起点标记
        if (this.startMarker) this.map.remove(this.startMarker);
        this.startMarker = new AMap.Marker({
            position: path[0],
            icon: new AMap.Icon({
                size: new AMap.Size(24, 24),
                image: 'data:image/svg+xml,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#10b981">
                        <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2"/>
                    </svg>
                `),
                imageSize: new AMap.Size(24, 24),
            }),
            offset: new AMap.Pixel(-12, -12),
        });
        this.map.add(this.startMarker);

        // 添加终点标记
        if (this.endMarker) this.map.remove(this.endMarker);
        this.endMarker = new AMap.Marker({
            position: path[path.length - 1],
            icon: new AMap.Icon({
                size: new AMap.Size(24, 24),
                image: 'data:image/svg+xml,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ef4444">
                        <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2"/>
                    </svg>
                `),
                imageSize: new AMap.Size(24, 24),
            }),
            offset: new AMap.Pixel(-12, -12),
        });
        this.map.add(this.endMarker);

        // 添加当前位置标记
        if (this.marker) this.map.remove(this.marker);
        this.marker = new AMap.Marker({
            position: path[0],
            icon: new AMap.Icon({
                size: new AMap.Size(32, 32),
                image: 'data:image/svg+xml,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
                        <circle cx="16" cy="16" r="12" fill="#3b82f6" stroke="white" stroke-width="3"/>
                        <circle cx="16" cy="16" r="6" fill="white"/>
                    </svg>
                `),
                imageSize: new AMap.Size(32, 32),
            }),
            offset: new AMap.Pixel(-16, -16),
            zIndex: 100,
        });
        this.map.add(this.marker);

        // 适应轨迹范围
        this.fitBounds();
    }

    updateMarkerPosition(point) {
        if (!this.marker || !point) return;
        this.marker.setPosition([point.lng, point.lat]);
    }

    fitBounds() {
        if (!this.map || !this.polyline) return;
        this.map.setFitView([this.polyline], false, [50, 50, 50, 50]);
    }

    zoomIn() {
        if (this.map) this.map.zoomIn();
    }

    zoomOut() {
        if (this.map) this.map.zoomOut();
    }
}

// ========================================
// Player - 播放控制器
// ========================================
class Player {
    constructor(options = {}) {
        this.currentSecond = 0;
        this.totalSeconds = 0;
        this.playing = false;
        this.speed = 60;
        this.interval = null;
        this.indexedPoints = [];

        this.onPositionChange = options.onPositionChange || (() => { });
        this.onTimeUpdate = options.onTimeUpdate || (() => { });
        this.onPlayStateChange = options.onPlayStateChange || (() => { });

        this.initControls();
    }

    initControls() {
        // 播放/暂停按钮
        this.$btnPlay = document.getElementById('btn-play');
        this.$btnBegin = document.getElementById('btn-begin');
        this.$btnEnd = document.getElementById('btn-end');
        this.$speedSelect = document.getElementById('speed-select');
        this.$timeline = document.getElementById('timeline');
        this.$timelineProgress = document.getElementById('timeline-progress');
        this.$timelineHandle = document.getElementById('timeline-handle');
        this.$currentTime = document.getElementById('current-time');
        this.$totalTime = document.getElementById('total-time');

        // 事件绑定
        this.$btnPlay.addEventListener('click', () => this.togglePlay());
        this.$btnBegin.addEventListener('click', () => this.seekTo(0));
        this.$btnEnd.addEventListener('click', () => this.seekTo(this.totalSeconds));
        this.$speedSelect.addEventListener('change', (e) => this.setSpeed(parseInt(e.target.value)));

        // 时间线点击
        this.$timeline.addEventListener('click', (e) => {
            const rect = this.$timeline.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            this.seekTo(Math.floor(percent * this.totalSeconds));
        });

        // 时间线拖拽
        let isDragging = false;
        this.$timelineHandle.addEventListener('mousedown', () => {
            isDragging = true;
            document.body.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const rect = this.$timeline.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            this.seekTo(Math.floor(percent * this.totalSeconds));
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = '';
            }
        });
    }

    setData(indexedPoints, totalSeconds) {
        this.indexedPoints = indexedPoints;
        this.totalSeconds = totalSeconds;
        this.currentSecond = 0;
        this.$totalTime.textContent = this.formatTime(totalSeconds);

        console.log('[Player] setData:', {
            totalSeconds,
            indexedPointsLength: indexedPoints.length,
            formattedTotal: this.formatTime(totalSeconds)
        });

        this.updateUI();
    }

    play() {
        if (this.playing) return;

        // 如果已经播放完毕，从头开始
        if (this.currentSecond >= this.totalSeconds) {
            this.currentSecond = 0;
        }

        this.playing = true;
        this.onPlayStateChange(true);
        this.updatePlayButton();

        this.interval = setInterval(() => {
            this.currentSecond += 1;

            if (this.currentSecond >= this.totalSeconds) {
                this.currentSecond = this.totalSeconds;
                this.pause();
            }

            this.updateUI();
            this.notifyPositionChange();
        }, 1000 / this.speed);
    }

    pause() {
        if (!this.playing) return;

        this.playing = false;
        this.onPlayStateChange(false);

        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        this.updatePlayButton();
    }

    togglePlay() {
        if (this.playing) {
            this.pause();
        } else {
            this.play();
        }
    }

    seekTo(second) {
        this.currentSecond = Math.max(0, Math.min(second, this.totalSeconds));
        this.updateUI();
        this.notifyPositionChange();
    }

    setSpeed(speed) {
        this.speed = speed;
        if (this.playing) {
            this.pause();
            this.play();
        }
    }

    updateUI() {
        const percent = this.totalSeconds > 0 ? (this.currentSecond / this.totalSeconds) * 100 : 0;

        this.$timelineProgress.style.width = `${percent}%`;
        this.$timelineHandle.style.left = `${percent}%`;
        this.$currentTime.textContent = this.formatTime(this.currentSecond);

        this.onTimeUpdate(this.currentSecond, this.totalSeconds);
    }

    updatePlayButton() {
        const icon = this.$btnPlay.querySelector('i');
        if (this.playing) {
            icon.classList.remove('fa-play');
            icon.classList.add('fa-pause');
            this.$btnPlay.title = '暂停';
        } else {
            icon.classList.remove('fa-pause');
            icon.classList.add('fa-play');
            this.$btnPlay.title = '播放';
        }
    }

    notifyPositionChange() {
        const point = this.indexedPoints[this.currentSecond];
        if (point) {
            this.onPositionChange(point, this.currentSecond);
        }
    }

    formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    getCurrentPoint() {
        return this.indexedPoints[this.currentSecond];
    }
}

// ========================================
// Data Panel - 数据面板（支持展开图表）
// ========================================
class DataPanel {
    constructor() {
        this.$panel = document.getElementById('data-panel');
        this.$time = document.getElementById('data-time');
        this.$distance = document.getElementById('data-distance');
        this.$toggle = document.getElementById('panel-toggle');
        this.$collapseToggle = document.getElementById('panel-collapse-toggle');
        this.$chartsContainer = document.getElementById('charts-container');

        // 图表数值显示元素（配速/心率/海拔仅在图表区显示）
        this.$chartPaceValue = document.getElementById('chart-pace-value');
        this.$chartHeartrateValue = document.getElementById('chart-heartrate-value');
        this.$chartAltitudeValue = document.getElementById('chart-altitude-value');

        this.expanded = false;          // 图表区是否展开
        this.panelCollapsed = false;    // 面板是否折叠
        this.chartManager = null;

        this.setupToggle();
    }

    setupToggle() {
        // 点击面板折叠按钮
        this.$collapseToggle.addEventListener('click', () => this.togglePanel());

        // 点击图表展开/收起按钮
        this.$toggle.addEventListener('click', () => this.toggleExpand());
    }

    // 切换面板整体折叠状态
    togglePanel() {
        this.panelCollapsed = !this.panelCollapsed;
        this.$panel.classList.toggle('collapsed', this.panelCollapsed);

        // 展开时恢复默认状态（图表区折叠）
        if (!this.panelCollapsed) {
            this.expanded = false;
            this.$panel.classList.remove('expanded');
            this.$chartsContainer.classList.add('collapsed');
        }
    }

    toggleExpand() {
        this.expanded = !this.expanded;
        this.$panel.classList.toggle('expanded', this.expanded);
        this.$chartsContainer.classList.toggle('collapsed', !this.expanded);

        // 首次展开时初始化图表
        if (this.expanded && this.chartManager) {
            this.chartManager.resize();
        }
    }

    setChartManager(chartManager) {
        this.chartManager = chartManager;
    }

    update(point, currentSecond) {
        // 面板折叠时跳过更新（性能优化）
        if (this.panelCollapsed || !point) return;

        // 摘要区：时间、距离
        this.$time.textContent = this.formatTime(currentSecond);

        const distance = point.distance !== undefined ? point.distance.toFixed(2) : '0.00';
        this.$distance.innerHTML = `${distance} <span class="data-unit">km</span>`;

        // 图表区：配速（缺失或无效时显示 0）
        let paceStr = '0';
        if (point.speed !== undefined && point.speed > 0) {
            const pace = 60 / point.speed;
            const paceMin = Math.floor(pace);
            const paceSec = Math.floor((pace - paceMin) * 60);
            paceStr = `${paceMin}'${paceSec.toString().padStart(2, '0')}"`;
        }
        if (this.$chartPaceValue) {
            this.$chartPaceValue.innerHTML = `${paceStr}<span class="chart-unit">/km</span>`;
        }

        // 图表区：心率（缺失时显示 0）
        if (this.$chartHeartrateValue) {
            const hr = (point.heart_rate !== undefined && point.heart_rate > 0)
                ? Math.round(point.heart_rate) : 0;
            this.$chartHeartrateValue.innerHTML = `${hr}<span class="chart-unit">bpm</span>`;
        }

        // 图表区：海拔（缺失时显示 0）
        if (this.$chartAltitudeValue) {
            const alt = point.altitude !== undefined ? Math.round(point.altitude) : 0;
            this.$chartAltitudeValue.innerHTML = `${alt}<span class="chart-unit">m</span>`;
        }

        // 更新图表当前位置指示线
        if (this.chartManager) {
            this.chartManager.updateIndicator(currentSecond);
        }
    }

    formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    reset() {
        // 摘要区
        this.$time.textContent = '00:00:00';
        this.$distance.innerHTML = '0.00 <span class="data-unit">km</span>';

        // 图表区重置为 0
        if (this.$chartPaceValue) this.$chartPaceValue.innerHTML = '0<span class="chart-unit">/km</span>';
        if (this.$chartHeartrateValue) this.$chartHeartrateValue.innerHTML = '0<span class="chart-unit">bpm</span>';
        if (this.$chartAltitudeValue) this.$chartAltitudeValue.innerHTML = '0<span class="chart-unit">m</span>';

        // 收起面板
        this.expanded = false;
        this.panelCollapsed = false;
        this.$panel.classList.remove('expanded', 'collapsed');
        this.$chartsContainer.classList.add('collapsed');
    }
}

// ========================================
// Chart Manager - 图表管理器
// ========================================
class ChartManager {
    constructor() {
        this.charts = {};
        this.totalSeconds = 0;
        this.initialized = false;

        // 图表配色（与 CSS 中颜色编码一致，顺序：配速/心率/海拔）
        this.colors = {
            pace: {
                line: '#34d399',
                fill: 'rgba(52, 211, 153, 0.2)'
            },
            heartrate: {
                line: '#f472b6',
                fill: 'rgba(244, 114, 182, 0.2)'
            },
            altitude: {
                line: '#60a5fa',
                fill: 'rgba(96, 165, 250, 0.2)'
            }
        };
    }

    initCharts(points, totalSeconds) {
        if (!window.Chart) {
            console.warn('Chart.js not loaded');
            return;
        }

        // 先销毁已有图表
        this.destroy();

        this.totalSeconds = totalSeconds;

        // 采样数据（减少渲染点数提高性能）
        const sampleRate = Math.max(1, Math.floor(points.length / 200));
        const sampledPoints = points.filter((_, i) => i % sampleRate === 0);

        const labels = sampledPoints.map(p => Math.round(p.elapsed_time));

        // 配速数据：直接使用速度(km/h)作为图表数据
        // 速度越快值越大，曲线越高，与心率图表一致
        const paceData = sampledPoints.map(p => p.speed || 0);

        const heartrateData = sampledPoints.map(p => p.heart_rate || 0);
        const altitudeData = sampledPoints.map(p => p.altitude || 0);

        // 通用图表配置
        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            scales: {
                x: {
                    display: false,
                    grid: { display: false }
                },
                y: {
                    display: false,
                    grid: { display: false }
                }
            },
            elements: {
                point: { radius: 0 },
                line: { tension: 0.4, borderWidth: 2 }
            }
        };

        // 创建配速图表（使用速度数据，曲线方向与心率一致）
        this.createChart('pace-chart', labels, paceData, this.colors.pace, commonOptions);

        // 创建心率图表
        this.createChart('heartrate-chart', labels, heartrateData, this.colors.heartrate, commonOptions);

        // 创建海拔图表
        this.createChart('altitude-chart', labels, altitudeData, this.colors.altitude, commonOptions);

        this.initialized = true;
        console.log('Charts initialized');
    }

    createChart(canvasId, labels, data, colors, options, reverseGradient = false) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // 销毁已存在的图表
        if (this.charts[canvasId]) {
            this.charts[canvasId].destroy();
        }

        const ctx = canvas.getContext('2d');

        // 创建渐变填充（可反转方向）
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        if (reverseGradient) {
            // 反转渐变：从底部（颜色）到顶部（透明）
            gradient.addColorStop(0, 'transparent');
            gradient.addColorStop(1, colors.fill);
        } else {
            // 正常渐变：从顶部（颜色）到底部（透明）
            gradient.addColorStop(0, colors.fill);
            gradient.addColorStop(1, 'transparent');
        }

        this.charts[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    borderColor: colors.line,
                    backgroundColor: gradient,
                    // 反转Y轴时使用 'end' 填充到底部
                    fill: reverseGradient ? 'end' : true,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointBackgroundColor: colors.line,
                }]
            },
            options: options,
            plugins: [{
                id: 'verticalIndicator',
                afterDraw: (chart) => {
                    if (chart.indicatorX !== undefined && chart.indicatorIndex !== undefined) {
                        const ctx = chart.ctx;
                        const chartArea = chart.chartArea;
                        const meta = chart.getDatasetMeta(0);

                        // 获取主题颜色
                        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                        const lineColor = isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.6)';

                        ctx.save();

                        // 绘制垂直指示线
                        ctx.beginPath();
                        ctx.moveTo(chart.indicatorX, chartArea.top);
                        ctx.lineTo(chart.indicatorX, chartArea.bottom);
                        ctx.strokeStyle = lineColor;
                        ctx.lineWidth = 2;
                        ctx.stroke();

                        // 绘制当前数据点高亮圆点
                        if (meta.data[chart.indicatorIndex]) {
                            const point = meta.data[chart.indicatorIndex];
                            ctx.beginPath();
                            ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
                            ctx.fillStyle = colors.line;
                            ctx.fill();
                            ctx.strokeStyle = isDark ? 'white' : 'white';
                            ctx.lineWidth = 2;
                            ctx.stroke();
                        }

                        ctx.restore();
                    }
                }
            }]
        });
    }

    updateIndicator(currentSecond) {
        if (!this.initialized || this.totalSeconds === 0) return;

        // 使用总时间百分比（与播放进度条一致）
        const percent = Math.max(0, Math.min(1, currentSecond / this.totalSeconds));

        Object.values(this.charts).forEach(chart => {
            const chartArea = chart.chartArea;
            const dataLength = chart.data.labels.length;

            if (chartArea && dataLength > 0) {
                // 直接使用时间百分比计算 X 坐标位置
                chart.indicatorX = chartArea.left + (chartArea.right - chartArea.left) * percent;
                // 根据百分比计算对应的数据点索引
                chart.indicatorIndex = Math.min(Math.floor(percent * dataLength), dataLength - 1);
                chart.update('none');
            }
        });
    }

    resize() {
        Object.values(this.charts).forEach(chart => {
            chart.resize();
        });
    }

    destroy() {
        Object.values(this.charts).forEach(chart => {
            chart.destroy();
        });
        this.charts = {};
        this.initialized = false;
    }
}

// ========================================
// App - 主应用
// ========================================
class App {
    constructor() {
        this.themeManager = new ThemeManager();
        this.fitParser = new FitParser();
        this.mapRenderer = new MapRenderer('map');
        this.dataPanel = new DataPanel();
        this.chartManager = new ChartManager();
        this.player = null;
        this.fitData = null;

        // 连接 ChartManager 到 DataPanel
        this.dataPanel.setChartManager(this.chartManager);

        this.init();
    }

    async init() {
        // 初始化地图
        await this.mapRenderer.init();

        // 初始化播放器
        this.player = new Player({
            onPositionChange: (point, second) => {
                this.mapRenderer.updateMarkerPosition(point);
                this.dataPanel.update(point, second);
            },
            onTimeUpdate: (current, total) => {
                // 可以添加额外的时间更新逻辑
            },
            onPlayStateChange: (playing) => {
                // 可以添加播放状态变化逻辑
            },
        });

        // 设置文件上传
        this.setupFileUpload();

        // 设置地图控制
        this.setupMapControls();

        // 设置新文件按钮
        document.getElementById('btn-new-file').addEventListener('click', () => {
            this.showUploadOverlay();
        });
    }

    setupFileUpload() {
        const uploadOverlay = document.getElementById('upload-overlay');
        const uploadBox = uploadOverlay.querySelector('.upload-box');
        const fileInput = document.getElementById('file-input');
        const selectFileBtn = document.getElementById('select-file-btn');

        // 点击选择文件
        selectFileBtn.addEventListener('click', () => fileInput.click());

        // 文件选择变化
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.loadFile(e.target.files[0]);
            }
        });

        // 拖拽上传
        uploadOverlay.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadBox.classList.add('drag-over');
        });

        uploadOverlay.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadBox.classList.remove('drag-over');
        });

        uploadOverlay.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadBox.classList.remove('drag-over');

            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].name.endsWith('.fit')) {
                this.loadFile(files[0]);
            }
        });
    }

    setupMapControls() {
        document.getElementById('zoom-in').addEventListener('click', () => {
            this.mapRenderer.zoomIn();
        });

        document.getElementById('zoom-out').addEventListener('click', () => {
            this.mapRenderer.zoomOut();
        });

        document.getElementById('fit-bounds').addEventListener('click', () => {
            this.mapRenderer.fitBounds();
        });
    }

    async loadFile(file) {
        try {
            console.log('Loading FIT file:', file.name);

            // 重置旧数据
            this.dataPanel.reset();
            this.chartManager.destroy();
            this.player.pause();

            const arrayBuffer = await file.arrayBuffer();
            this.fitData = await this.fitParser.parse(arrayBuffer);

            console.log('Parsed FIT data:', this.fitData);

            if (this.fitData.points.length === 0) {
                alert('该 FIT 文件没有 GPS 数据');
                return;
            }

            // 绘制轨迹
            this.mapRenderer.drawTrack(this.fitData.points);

            // 初始化图表数据
            this.chartManager.initCharts(this.fitData.points, this.fitData.totalSeconds);

            // 设置播放器数据
            this.player.setData(this.fitData.indexedPoints, this.fitData.totalSeconds);

            // 更新初始数据面板
            this.dataPanel.update(this.fitData.indexedPoints[0], 0);

            // 隐藏上传覆盖层，显示控制面板
            this.hideUploadOverlay();
            this.showControls();

        } catch (error) {
            console.error('Error loading FIT file:', error);
            alert('加载 FIT 文件失败: ' + error.message);
        }
    }

    hideUploadOverlay() {
        document.getElementById('upload-overlay').classList.add('hidden');
    }

    showUploadOverlay() {
        document.getElementById('upload-overlay').classList.remove('hidden');
        document.getElementById('player-controls').classList.add('hidden');
        document.getElementById('data-panel').classList.add('hidden');
    }

    showControls() {
        document.getElementById('player-controls').classList.remove('hidden');
        document.getElementById('data-panel').classList.remove('hidden');
    }
}

// ========================================
// Initialize App
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});

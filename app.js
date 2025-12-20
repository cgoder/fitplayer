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
// 多用户配置 - 支持最多 4 个用户同时对比
// ========================================
const MAX_FILES = 4;
const USER_STYLES = [
    { color: '#3b82f6', label: '用户 1', avatarBg: '#2563eb', textColor: '#ffffff' }, // 蓝色
    { color: '#ef4444', label: '用户 2', avatarBg: '#dc2626', textColor: '#ffffff' }, // 红色
    { color: '#10b981', label: '用户 3', avatarBg: '#059669', textColor: '#ffffff' }, // 绿色
    { color: '#f59e0b', label: '用户 4', avatarBg: '#d97706', textColor: '#ffffff' }  // 橙色
];

/**
 * 生成用户头像 SVG 图标
 * @param {number} userIndex 用户索引 (0-3)
 * @param {number} size 图标尺寸
 * @returns {string} SVG 数据 URL
 */
function generateAvatarIcon(userIndex, size = 32) {
    const style = USER_STYLES[userIndex] || USER_STYLES[0];
    const label = userIndex + 1;
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="${style.avatarBg}" stroke="white" stroke-width="2"/>
            <text x="${size / 2}" y="${size / 2 + 5}" text-anchor="middle" fill="${style.textColor}" font-size="${size * 0.45}" font-weight="bold" font-family="Inter, sans-serif">${label}</text>
        </svg>
    `;
    return 'data:image/svg+xml,' + encodeURIComponent(svg.trim());
}

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
// TCX Parser - TCX 文件解析器 (XML 格式)
// ========================================
class TcxParser {
    async parse(arrayBuffer) {
        try {
            const text = new TextDecoder('utf-8').decode(arrayBuffer);
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/xml');

            // 检查解析错误
            const parseError = doc.querySelector('parsererror');
            if (parseError) {
                throw new Error('无效的 TCX 文件格式');
            }

            // 获取所有 Trackpoint 元素
            const trackpoints = doc.querySelectorAll('Trackpoint');
            if (trackpoints.length === 0) {
                throw new Error('TCX 文件中没有找到轨迹点');
            }

            const points = [];
            let startTime = null;

            trackpoints.forEach((tp, index) => {
                const timeEl = tp.querySelector('Time');
                const posEl = tp.querySelector('Position');
                const hrEl = tp.querySelector('HeartRateBpm Value');
                const altEl = tp.querySelector('AltitudeMeters');
                const distEl = tp.querySelector('DistanceMeters');
                const cadenceEl = tp.querySelector('Cadence') || tp.querySelector('RunCadence');

                // 必须有位置信息
                if (!posEl) return;

                const latEl = posEl.querySelector('LatitudeDegrees');
                const lngEl = posEl.querySelector('LongitudeDegrees');

                if (!latEl || !lngEl) return;

                const lat = parseFloat(latEl.textContent);
                const lng = parseFloat(lngEl.textContent);

                // 验证坐标有效性
                if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

                const timestamp = timeEl ? new Date(timeEl.textContent) : null;
                if (!startTime && timestamp) startTime = timestamp;

                const elapsed_time = (startTime && timestamp)
                    ? (timestamp.getTime() - startTime.getTime()) / 1000
                    : index;

                // WGS-84 转 GCJ-02 (适配高德地图)
                const gcj02 = CoordTransform.wgs84ToGcj02(lng, lat);

                // 解析速度（从扩展中获取）
                let speed = null;
                const speedEl = tp.querySelector('Extensions Speed') || tp.querySelector('ns3\\:Speed') || tp.querySelector('Speed');
                if (speedEl) {
                    speed = parseFloat(speedEl.textContent);
                }

                points.push({
                    index: points.length,
                    lat: gcj02.lat,
                    lng: gcj02.lng,
                    wgs84_lat: lat,
                    wgs84_lng: lng,
                    timestamp,
                    elapsed_time,
                    heart_rate: hrEl ? parseInt(hrEl.textContent) : undefined,
                    speed,
                    altitude: altEl ? parseFloat(altEl.textContent) : undefined,
                    distance: distEl ? parseFloat(distEl.textContent) / 1000 : undefined, // 转换为公里
                    cadence: cadenceEl ? parseInt(cadenceEl.textContent) : undefined,
                });
            });

            console.log('TCX - Valid GPS points:', points.length);
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

        } catch (error) {
            console.error('TCX 解析错误:', error);
            throw error;
        }
    }

    createIndexedPoints(points, totalSeconds) {
        if (points.length === 0) return [];

        const indexed = [];
        let pointIndex = 0;

        for (let second = 0; second <= totalSeconds; second++) {
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
// GPX Parser - GPX 文件解析器 (XML 格式)
// ========================================
class GpxParser {
    async parse(arrayBuffer) {
        try {
            const text = new TextDecoder('utf-8').decode(arrayBuffer);
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/xml');

            // 检查解析错误
            const parseError = doc.querySelector('parsererror');
            if (parseError) {
                throw new Error('无效的 GPX 文件格式');
            }

            // 获取所有轨迹点 (trkpt)
            const trkpts = doc.querySelectorAll('trkpt');
            if (trkpts.length === 0) {
                throw new Error('GPX 文件中没有找到轨迹点');
            }

            const points = [];
            let startTime = null;
            let totalDistance = 0;
            let prevPoint = null;

            trkpts.forEach((trkpt, index) => {
                const lat = parseFloat(trkpt.getAttribute('lat'));
                const lng = parseFloat(trkpt.getAttribute('lon'));

                // 验证坐标有效性
                if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

                const timeEl = trkpt.querySelector('time');
                const eleEl = trkpt.querySelector('ele');
                const hrEl = trkpt.querySelector('hr') || trkpt.querySelector('gpxtpx\\:hr') || trkpt.querySelector('ns3\\:hr');
                const cadenceEl = trkpt.querySelector('cad') || trkpt.querySelector('gpxtpx\\:cad') || trkpt.querySelector('ns3\\:cad');

                const timestamp = timeEl ? new Date(timeEl.textContent) : null;
                if (!startTime && timestamp) startTime = timestamp;

                const elapsed_time = (startTime && timestamp)
                    ? (timestamp.getTime() - startTime.getTime()) / 1000
                    : index;

                // WGS-84 转 GCJ-02 (适配高德地图)
                const gcj02 = CoordTransform.wgs84ToGcj02(lng, lat);

                // 计算距离（使用 Haversine 公式）
                if (prevPoint) {
                    const dist = this.haversineDistance(prevPoint.wgs84_lat, prevPoint.wgs84_lng, lat, lng);
                    totalDistance += dist;
                }

                // 计算速度（米/秒转公里/小时）
                let speed = null;
                if (prevPoint && timestamp && prevPoint.timestamp) {
                    const timeDiff = (timestamp.getTime() - prevPoint.timestamp.getTime()) / 1000; // 秒
                    if (timeDiff > 0) {
                        const dist = this.haversineDistance(prevPoint.wgs84_lat, prevPoint.wgs84_lng, lat, lng);
                        speed = (dist / timeDiff) * 3.6; // 转换为 km/h
                    }
                }

                const point = {
                    index: points.length,
                    lat: gcj02.lat,
                    lng: gcj02.lng,
                    wgs84_lat: lat,
                    wgs84_lng: lng,
                    timestamp,
                    elapsed_time,
                    heart_rate: hrEl ? parseInt(hrEl.textContent) : undefined,
                    speed,
                    altitude: eleEl ? parseFloat(eleEl.textContent) : undefined,
                    distance: totalDistance / 1000, // 转换为公里
                    cadence: cadenceEl ? parseInt(cadenceEl.textContent) : undefined,
                };

                points.push(point);
                prevPoint = point;
            });

            console.log('GPX - Valid GPS points:', points.length);
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

        } catch (error) {
            console.error('GPX 解析错误:', error);
            throw error;
        }
    }

    // Haversine 公式计算两点间距离（米）
    haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // 地球半径（米）
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    createIndexedPoints(points, totalSeconds) {
        if (points.length === 0) return [];

        const indexed = [];
        let pointIndex = 0;

        for (let second = 0; second <= totalSeconds; second++) {
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
// Map Renderer - 地图渲染器 (高德地图) - 多用户支持
// ========================================
class MapRenderer {
    constructor(containerId) {
        this.containerId = containerId;
        this.map = null;
        // 多用户支持：存储每个会话的图层元素
        this.sessions = []; // { polyline, startMarker, endMarker, marker, points }
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
                    // 截图功能必需参数
                    WebGLParams: { preserveDrawingBuffer: true },
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

    /**
     * 清除所有会话的地图元素
     */
    clearAll() {
        if (!this.map) return;

        this.sessions.forEach(session => {
            if (session.polyline) this.map.remove(session.polyline);
            if (session.startMarker) this.map.remove(session.startMarker);
            if (session.endMarker) this.map.remove(session.endMarker);
            if (session.marker) this.map.remove(session.marker);
        });
        this.sessions = [];
    }

    /**
     * 绘制多个会话的轨迹
     * @param {Array} sessionsData - 会话数据数组 [{ points, fileName, ... }, ...]
     */
    drawTracks(sessionsData) {
        if (!this.map) return;

        // 清除旧数据
        this.clearAll();

        sessionsData.forEach((sessionData, index) => {
            const points = sessionData.points;
            if (!points || points.length === 0) return;

            const style = USER_STYLES[index] || USER_STYLES[0];
            const path = points.map(p => [p.lng, p.lat]);

            // 创建轨迹线
            const polyline = new AMap.Polyline({
                path: path,
                strokeColor: style.color,
                strokeWeight: 4,
                strokeOpacity: 0.8,
                lineJoin: 'round',
                lineCap: 'round',
            });
            this.map.add(polyline);

            // 起点标记（使用用户颜色的小圆点）
            const startMarker = new AMap.Marker({
                position: path[0],
                icon: new AMap.Icon({
                    size: new AMap.Size(16, 16),
                    image: 'data:image/svg+xml,' + encodeURIComponent(`
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
                            <circle cx="8" cy="8" r="6" fill="${style.color}" stroke="white" stroke-width="2"/>
                        </svg>
                    `),
                    imageSize: new AMap.Size(16, 16),
                }),
                offset: new AMap.Pixel(-8, -8),
                zIndex: 50 + index,
            });
            this.map.add(startMarker);

            // 终点标记
            const endMarker = new AMap.Marker({
                position: path[path.length - 1],
                icon: new AMap.Icon({
                    size: new AMap.Size(16, 16),
                    image: 'data:image/svg+xml,' + encodeURIComponent(`
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
                            <rect x="2" y="2" width="12" height="12" rx="2" fill="${style.color}" stroke="white" stroke-width="2"/>
                        </svg>
                    `),
                    imageSize: new AMap.Size(16, 16),
                }),
                offset: new AMap.Pixel(-8, -8),
                zIndex: 50 + index,
            });
            this.map.add(endMarker);

            // 当前位置标记（带编号的头像）
            const marker = new AMap.Marker({
                position: path[0],
                icon: new AMap.Icon({
                    size: new AMap.Size(36, 36),
                    image: generateAvatarIcon(index, 36),
                    imageSize: new AMap.Size(36, 36),
                }),
                offset: new AMap.Pixel(-18, -18),
                zIndex: 100 + index,
            });
            this.map.add(marker);

            // 存储会话信息
            this.sessions.push({
                polyline,
                startMarker,
                endMarker,
                marker,
                points,
            });
        });

        // 适应所有轨迹范围
        this.fitBounds();
    }

    /**
     * 更新多个会话的标记位置
     * @param {Array} pointsArray - 各会话当前点位数组 [point1, point2, ...]
     */
    updateMarkerPositions(pointsArray) {
        if (!this.map) return;

        pointsArray.forEach((point, index) => {
            const session = this.sessions[index];
            if (!session || !session.marker || !point) return;

            // 使用已转换的 GCJ-02 坐标
            const position = [point.lng, point.lat];
            session.marker.setPosition(position);
        });
    }

    /**
     * 单个会话的兼容方法（向后兼容）
     */
    drawTrack(points) {
        this.drawTracks([{ points }]);
    }

    updateMarkerPosition(point) {
        this.updateMarkerPositions([point]);
    }

    fitBounds() {
        if (!this.map || this.sessions.length === 0) return;
        const polylines = this.sessions.map(s => s.polyline).filter(Boolean);
        if (polylines.length > 0) {
            this.map.setFitView(polylines, false, [50, 50, 50, 50]);
        }
    }

    zoomIn() {
        if (this.map) this.map.zoomIn();
    }

    zoomOut() {
        if (this.map) this.map.zoomOut();
    }
}

// ========================================
// Player - 播放控制器 - 多用户支持
// ========================================
class Player {
    constructor(options = {}) {
        this.currentSecond = 0;
        this.totalSeconds = 0;
        this.playing = false;
        this.speed = 120;
        this.interval = null;
        // 多用户支持：存储多个会话的索引点
        this.sessions = []; // [{ indexedPoints, totalSeconds, fileName }, ...]

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

        console.log('[Player] initControls - Elements found:', {
            btnPlay: !!this.$btnPlay,
            btnBegin: !!this.$btnBegin,
            btnEnd: !!this.$btnEnd,
            speedSelect: !!this.$speedSelect,
            timeline: !!this.$timeline
        });

        // 事件绑定
        if (this.$btnPlay) {
            this.$btnPlay.addEventListener('click', () => {
                console.log('[Player] Play button clicked');
                this.togglePlay();
            });
        }
        if (this.$btnBegin) {
            this.$btnBegin.addEventListener('click', () => this.seekTo(0));
        }
        if (this.$btnEnd) {
            this.$btnEnd.addEventListener('click', () => this.seekTo(this.totalSeconds));
        }
        if (this.$speedSelect) {
            this.$speedSelect.addEventListener('change', (e) => this.setSpeed(parseInt(e.target.value)));
        }

        // 时间线点击
        if (this.$timeline) {
            this.$timeline.addEventListener('click', (e) => {
                const rect = this.$timeline.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                this.seekTo(Math.floor(percent * this.totalSeconds));
            });
        }

        // 时间线拖拽
        let isDragging = false;
        if (this.$timelineHandle) {
            this.$timelineHandle.addEventListener('mousedown', () => {
                isDragging = true;
                document.body.style.cursor = 'grabbing';
            });
        }

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

    /**
     * 设置多个会话数据
     * @param {Array} sessions - 会话数组 [{ indexedPoints, totalSeconds, fileName }, ...]
     * @param {number} globalTotalSeconds - 全局最大时长
     */
    setSessionsData(sessions, globalTotalSeconds) {
        this.sessions = sessions;
        this.totalSeconds = globalTotalSeconds;
        this.currentSecond = 0;
        this.$totalTime.textContent = this.formatTime(globalTotalSeconds);

        console.log('[Player] setSessionsData:', {
            sessionsCount: sessions.length,
            globalTotalSeconds,
            formattedTotal: this.formatTime(globalTotalSeconds)
        });

        this.updateUI();
    }

    /**
     * 向后兼容：单会话数据
     */
    setData(indexedPoints, totalSeconds) {
        this.setSessionsData([{ indexedPoints, totalSeconds }], totalSeconds);
    }

    play() {
        console.log('[Player] play() called', {
            playing: this.playing,
            currentSecond: this.currentSecond,
            totalSeconds: this.totalSeconds,
            sessionsCount: this.sessions.length
        });

        if (this.playing) return;

        // 如果已经播放完毕，从头开始
        if (this.currentSecond >= this.totalSeconds) {
            this.currentSecond = 0;
        }

        this.playing = true;
        this.onPlayStateChange(true);
        this.$btnPlay.innerHTML = '<i class="fas fa-pause"></i>';

        console.log('[Player] Starting playback interval');

        this.interval = setInterval(() => {
            this.currentSecond++;

            if (this.currentSecond >= this.totalSeconds) {
                this.pause();
                return;
            }

            this.updateUI();
            this.notifyPositionChange();
        }, 1000 / this.speed);
    }

    pause() {
        console.log('[Player] pause() called');
        if (!this.playing) return;

        this.playing = false;
        this.onPlayStateChange(false);
        clearInterval(this.interval);
        this.interval = null;

        this.$btnPlay.innerHTML = '<i class="fas fa-play"></i>';
    }

    togglePlay() {
        console.log('[Player] togglePlay() called, current state:', this.playing);
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

    /**
     * 通知位置变化（多用户版本）
     * 返回每个会话当前时间点的数据
     * 当会话已结束时，返回 null 以表示数据应显示为 0
     */
    notifyPositionChange() {
        const pointsArray = this.sessions.map(session => {
            // 如果当前时间超过该会话的时长，返回 null（数据显示为 0）
            if (this.currentSecond >= session.totalSeconds) {
                return null;
            }
            return session.indexedPoints[this.currentSecond] || null;
        });

        this.onPositionChange(pointsArray, this.currentSecond);
    }

    formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * 获取所有会话的当前点
     * 当会话已结束时，返回 null
     */
    getCurrentPoints() {
        return this.sessions.map(session => {
            // 如果当前时间超过该会话的时长，返回 null
            if (this.currentSecond >= session.totalSeconds) {
                return null;
            }
            return session.indexedPoints[this.currentSecond] || null;
        });
    }

    /**
     * 向后兼容：获取单个点
     */
    getCurrentPoint() {
        const points = this.getCurrentPoints();
        return points[0] || null;
    }
}

// ========================================
// Data Panel - 数据面板（支持展开图表）- 多用户支持
// ========================================
class DataPanel {
    constructor() {
        this.$panel = document.getElementById('data-panel');
        this.$summary = document.getElementById('data-summary');
        this.$chartsContainer = document.getElementById('charts-container');

        // 多用户图表数值容器
        this.$chartPaceValues = document.getElementById('chart-pace-values');
        this.$chartHeartrateValues = document.getElementById('chart-heartrate-values');
        this.$chartAltitudeValues = document.getElementById('chart-altitude-values');

        this.expanded = false;          // 图表区是否展开
        this.chartManager = null;
        this.sessions = [];             // 存储会话信息

        // 点击摘要区域展开/收起图表
        if (this.$summary) {
            this.$summary.style.cursor = 'pointer';
            this.$summary.addEventListener('click', () => this.toggleExpand());
        }

        // 默认展开状态
        this.expanded = true;
        if (this.$panel) this.$panel.classList.add('expanded');
        if (this.$chartsContainer) this.$chartsContainer.classList.remove('collapsed');
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

    /**
     * 初始化多用户数据摘要区
     * @param {Array} sessions - 会话数组
     */
    initSummaries(sessions) {
        this.sessions = sessions;

        if (!this.$summary) return;

        // 清空现有内容
        this.$summary.innerHTML = '';

        sessions.forEach((session, index) => {
            const style = USER_STYLES[index] || USER_STYLES[0];
            const fileName = session.fileName || `用户 ${index + 1}`;

            // 获取总时间和总距离
            const totalTime = this.formatTime(session.totalSeconds || 0);
            const lastPoint = session.points && session.points.length > 0
                ? session.points[session.points.length - 1]
                : null;
            const totalDistance = lastPoint && lastPoint.distance !== undefined
                ? lastPoint.distance.toFixed(2)
                : '0.00';

            // 创建用户行
            const row = document.createElement('div');
            row.className = 'data-user-row';
            row.dataset.userIndex = index;

            row.innerHTML = `
                <div class="user-avatar" style="background-color: ${style.avatarBg}">
                    ${index + 1}
                </div>
                <div class="user-data">
                    <span class="user-name" title="${fileName}">${this.truncateFileName(fileName)}</span>
                    <div class="user-stats">
                        <span class="stat-item">
                            <span class="stat-value" data-field="time">${totalTime}</span>
                        </span>
                        <span class="stat-item">
                            <span class="stat-value" data-field="distance">${totalDistance}</span>
                            <span class="stat-unit">km</span>
                        </span>
                    </div>
                </div>
            `;

            this.$summary.appendChild(row);
        });

        // 初始化图表值显示区
        this.initChartValues(sessions);
    }

    /**
     * 初始化图表值显示（多用户）
     */
    initChartValues(sessions) {
        const containers = [
            { el: this.$chartPaceValues, unit: '/km' },
            { el: this.$chartHeartrateValues, unit: 'bpm' },
            { el: this.$chartAltitudeValues, unit: 'm' }
        ];

        containers.forEach(container => {
            if (!container.el) return;
            container.el.innerHTML = '';

            sessions.forEach((session, index) => {
                const style = USER_STYLES[index] || USER_STYLES[0];
                const span = document.createElement('span');
                span.className = 'chart-value';
                span.dataset.userIndex = index;
                span.style.color = style.color;
                span.innerHTML = `<span class="value">0</span><span class="chart-unit">${container.unit}</span>`;
                container.el.appendChild(span);
            });
        });
    }

    /**
     * 更新多用户数据
     * @param {Array} pointsArray - 各用户当前点位数组
     * @param {number} currentSecond - 当前时间（秒）
     */
    updateMultiple(pointsArray, currentSecond) {
        if (!pointsArray || pointsArray.length === 0) return;

        pointsArray.forEach((point, index) => {
            this.updateUserRow(index, point, currentSecond);
            this.updateChartValues(index, point);
        });

        // 更新图表当前位置指示线
        if (this.chartManager) {
            this.chartManager.updateIndicator(currentSecond);
        }
    }

    /**
     * 更新单个用户行
     * 当 point 为 null 时，表示该会话已结束，显示 0
     */
    updateUserRow(index, point, currentSecond) {
        const row = this.$summary?.querySelector(`[data-user-index="${index}"]`);
        if (!row) return;

        const timeEl = row.querySelector('[data-field="time"]');
        const distanceEl = row.querySelector('[data-field="distance"]');

        // 如果 point 为 null，表示会话已结束，显示 0
        if (!point) {
            if (timeEl) {
                timeEl.textContent = '00:00:00';
            }
            if (distanceEl) {
                distanceEl.textContent = '0.00';
            }
            return;
        }

        const session = this.sessions[index];
        const second = session ? Math.min(currentSecond, session.totalSeconds) : currentSecond;

        if (timeEl) {
            timeEl.textContent = this.formatTime(second);
        }

        if (distanceEl) {
            const distance = point.distance !== undefined ? point.distance.toFixed(2) : '0.00';
            distanceEl.textContent = distance;
        }
    }

    /**
     * 更新图表值显示
     * 当 point 为 null 时，表示该会话已结束，显示 0
     */
    updateChartValues(index, point) {
        const paceEl = this.$chartPaceValues?.querySelector(`[data-user-index="${index}"] .value`);
        const hrEl = this.$chartHeartrateValues?.querySelector(`[data-user-index="${index}"] .value`);
        const altEl = this.$chartAltitudeValues?.querySelector(`[data-user-index="${index}"] .value`);

        // 如果 point 为 null，表示会话已结束，显示 0
        if (!point) {
            if (paceEl) paceEl.textContent = '0';
            if (hrEl) hrEl.textContent = '0';
            if (altEl) altEl.textContent = '0';
            return;
        }

        // 配速
        if (paceEl) {
            let paceStr = '0';
            if (point.speed !== undefined && point.speed > 0) {
                const pace = 60 / point.speed;
                const paceMin = Math.floor(pace);
                const paceSec = Math.floor((pace - paceMin) * 60);
                paceStr = `${paceMin}'${paceSec.toString().padStart(2, '0')}"`;
            }
            paceEl.textContent = paceStr;
        }

        // 心率
        if (hrEl) {
            const hr = (point.heart_rate !== undefined && point.heart_rate > 0)
                ? Math.round(point.heart_rate) : 0;
            hrEl.textContent = hr;
        }

        // 海拔
        if (altEl) {
            const alt = point.altitude !== undefined ? Math.round(point.altitude) : 0;
            altEl.textContent = alt;
        }
    }

    /**
     * 向后兼容：单用户更新
     */
    update(point, currentSecond) {
        this.updateMultiple([point], currentSecond);
    }

    truncateFileName(name) {
        // 移除文件扩展名
        const baseName = name.replace(/\.(fit|tcx|gpx)$/i, '');
        if (baseName.length > 15) {
            return baseName.substring(0, 12) + '...';
        }
        return baseName;
    }

    formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    reset() {
        // 清空摘要区
        if (this.$summary) {
            this.$summary.innerHTML = '';
        }

        // 清空图表值
        if (this.$chartPaceValues) this.$chartPaceValues.innerHTML = '';
        if (this.$chartHeartrateValues) this.$chartHeartrateValues.innerHTML = '';
        if (this.$chartAltitudeValues) this.$chartAltitudeValues.innerHTML = '';

        this.sessions = [];

        // 收起面板
        this.expanded = false;
        if (this.$panel) this.$panel.classList.remove('expanded', 'collapsed');
        if (this.$chartsContainer) this.$chartsContainer.classList.add('collapsed');
    }
}

// ========================================
// Chart Manager - 图表管理器 - 多用户支持
// ========================================
class ChartManager {
    constructor() {
        this.charts = {};
        this.totalSeconds = 0;
        this.initialized = false;
        this.sessionsCount = 0;
    }

    /**
     * 初始化多用户图表
     * @param {Array} sessions - 会话数组 [{ points, totalSeconds, ... }, ...]
     * @param {number} globalTotalSeconds - 全局最大时长
     */
    initMultiCharts(sessions, globalTotalSeconds) {
        if (!window.Chart) {
            console.warn('Chart.js not loaded');
            return;
        }

        // 先销毁已有图表
        this.destroy();

        this.totalSeconds = globalTotalSeconds;
        this.sessionsCount = sessions.length;

        // 创建统一的全局时间标签（基于最大时长）
        // 采样200个点用于显示
        const sampleCount = 200;
        const globalLabels = [];
        for (let i = 0; i <= sampleCount; i++) {
            globalLabels.push(Math.round((i / sampleCount) * globalTotalSeconds));
        }

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
                line: {
                    tension: 0.4,
                    borderWidth: 2,
                    spanGaps: false  // 不连接 null 值之间的间隙
                }
            }
        };

        // 为每类图表准备多用户数据集
        const paceDatasets = [];
        const heartrateDatasets = [];
        const altitudeDatasets = [];

        // 判断是否为单用户模式（使用渐变填充效果）
        const isSingleUser = sessions.length === 1;

        // 单用户模式的渐变颜色配置（与原设计一致）
        const chartColors = {
            pace: {
                border: '#34d399',
                fill: 'rgba(52, 211, 153, 0.3)',
                gradient: ['rgba(52, 211, 153, 0.5)', 'rgba(52, 211, 153, 0.05)']
            },
            heartrate: {
                border: '#f472b6',
                fill: 'rgba(244, 114, 182, 0.3)',
                gradient: ['rgba(244, 114, 182, 0.5)', 'rgba(244, 114, 182, 0.05)']
            },
            altitude: {
                border: '#60a5fa',
                fill: 'rgba(96, 165, 250, 0.3)',
                gradient: ['rgba(96, 165, 250, 0.5)', 'rgba(96, 165, 250, 0.05)']
            }
        };

        sessions.forEach((session, index) => {
            const points = session.points;
            if (!points || points.length === 0) return;

            const style = USER_STYLES[index] || USER_STYLES[0];
            const sessionTotalSeconds = session.totalSeconds;

            // 为该用户创建对齐到全局时间轴的数据点
            // 超过用户自身时长的部分填充 null
            const paceData = [];
            const heartrateData = [];
            const altitudeData = [];

            globalLabels.forEach(globalSecond => {
                if (globalSecond > sessionTotalSeconds) {
                    // 超过该用户的时长，填充 null
                    paceData.push(null);
                    heartrateData.push(null);
                    altitudeData.push(null);
                } else {
                    // 找到该时间点对应的数据
                    // 使用线性插值或最近点
                    const point = this.findPointAtTime(points, globalSecond);
                    if (point) {
                        paceData.push(point.speed || 0);
                        heartrateData.push(point.heart_rate || 0);
                        altitudeData.push(point.altitude || 0);
                    } else {
                        paceData.push(null);
                        heartrateData.push(null);
                        altitudeData.push(null);
                    }
                }
            });

            // 配速数据
            paceDatasets.push({
                label: style.label,
                data: paceData,
                borderColor: isSingleUser ? chartColors.pace.border : style.color,
                backgroundColor: isSingleUser ? chartColors.pace.fill : 'transparent',
                fill: isSingleUser ? 'origin' : false,
                pointRadius: 0,
                borderWidth: 2,
                spanGaps: false,
            });

            // 心率数据
            heartrateDatasets.push({
                label: style.label,
                data: heartrateData,
                borderColor: isSingleUser ? chartColors.heartrate.border : style.color,
                backgroundColor: isSingleUser ? chartColors.heartrate.fill : 'transparent',
                fill: isSingleUser ? 'origin' : false,
                pointRadius: 0,
                borderWidth: 2,
                spanGaps: false,
            });

            // 海拔数据
            altitudeDatasets.push({
                label: style.label,
                data: altitudeData,
                borderColor: isSingleUser ? chartColors.altitude.border : style.color,
                backgroundColor: isSingleUser ? chartColors.altitude.fill : 'transparent',
                fill: isSingleUser ? 'origin' : false,
                pointRadius: 0,
                borderWidth: 2,
                spanGaps: false,
            });
        });

        // 创建图表
        this.createMultiChart('pace-chart', globalLabels, paceDatasets, commonOptions);
        this.createMultiChart('heartrate-chart', globalLabels, heartrateDatasets, commonOptions);
        this.createMultiChart('altitude-chart', globalLabels, altitudeDatasets, commonOptions);

        this.initialized = true;
        console.log('Multi-user charts initialized with', sessions.length, 'sessions, globalTotalSeconds:', globalTotalSeconds);
    }

    /**
     * 根据时间查找最近的数据点
     * @param {Array} points - 数据点数组
     * @param {number} targetSecond - 目标时间（秒）
     * @returns {Object|null} - 找到的数据点
     */
    findPointAtTime(points, targetSecond) {
        if (!points || points.length === 0) return null;

        // 二分查找最接近的点
        let left = 0;
        let right = points.length - 1;

        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (points[mid].elapsed_time < targetSecond) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        // 检查左边的点是否更接近
        if (left > 0) {
            const leftDiff = Math.abs(points[left - 1].elapsed_time - targetSecond);
            const rightDiff = Math.abs(points[left].elapsed_time - targetSecond);
            if (leftDiff < rightDiff) {
                return points[left - 1];
            }
        }

        return points[left];
    }

    /**
     * 向后兼容：单会话图表
     */
    initCharts(points, totalSeconds) {
        this.initMultiCharts([{ points, totalSeconds }], totalSeconds);
    }

    createMultiChart(canvasId, labels, datasets, options) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // 销毁已存在的图表
        if (this.charts[canvasId]) {
            this.charts[canvasId].destroy();
        }

        const ctx = canvas.getContext('2d');

        this.charts[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: options,
            plugins: [{
                id: 'verticalIndicator',
                afterDraw: (chart) => {
                    if (chart.indicatorX !== undefined && chart.indicatorIndex !== undefined) {
                        const ctx = chart.ctx;
                        const chartArea = chart.chartArea;

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

                        // 为每个数据集绘制高亮圆点
                        chart.data.datasets.forEach((dataset, datasetIndex) => {
                            // 检查该位置的数据是否为 null（会话已结束）
                            const dataValue = dataset.data[chart.indicatorIndex];
                            if (dataValue === null || dataValue === undefined) {
                                // 会话已结束，不绘制圆点
                                return;
                            }

                            const meta = chart.getDatasetMeta(datasetIndex);
                            if (meta.data[chart.indicatorIndex]) {
                                const point = meta.data[chart.indicatorIndex];
                                ctx.beginPath();
                                ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
                                ctx.fillStyle = dataset.borderColor;
                                ctx.fill();
                                ctx.strokeStyle = 'white';
                                ctx.lineWidth = 2;
                                ctx.stroke();
                            }
                        });

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
// Video Exporter - 视频导出器
// 使用 @amap/screenshot 截图 + Canvas 合成 + MediaRecorder
// ========================================
// ========================================
// Video Exporter - 视频导出器
// 使用 Canvas 组合 + MediaRecorder (高性能/MP4)
// ========================================
class VideoExporter {
    constructor(options = {}) {
        this.mapRenderer = options.mapRenderer || null;
        this.chartManager = options.chartManager || null;
        this.player = options.player || null;

        // 会话数据 (用于手动绘制 Avatar)
        this.sessions = [];

        this.compositeCanvas = null;
        this.ctx = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.animationFrameId = null;

        // 输出规格
        this.outputWidth = 1920;  // 1080p
        this.outputHeight = 1080;
        this.bitRate = 3500000;   // 3.5 Mbps - 提高到 3.5M 以保证 60FPS 质量

        this.onRecordingStart = options.onRecordingStart || (() => { });
        this.onRecordingStop = options.onRecordingStop || (() => { });
        this.onError = options.onError || ((err) => console.error('[VideoExporter] Error:', err));

        // 菜单元素
        this.$btnMenu = document.getElementById('btn-menu');
        this.$menuDropdown = document.getElementById('menu-dropdown');
        this.$btnExport = document.getElementById('btn-export-mp4');

        this.initControls();
    }

    initControls() {
        // 菜单按钮点击 - 切换下拉菜单
        if (this.$btnMenu && this.$menuDropdown) {
            this.$btnMenu.addEventListener('click', (e) => {
                e.stopPropagation();
                this.$menuDropdown.classList.toggle('hidden');
            });

            // 点击其他地方关闭菜单
            document.addEventListener('click', (e) => {
                if (!this.$menuDropdown.contains(e.target) && e.target !== this.$btnMenu) {
                    this.$menuDropdown.classList.add('hidden');
                }
            });
        }

        // 导出按钮点击
        if (this.$btnExport) {
            this.$btnExport.addEventListener('click', () => {
                // 关闭菜单
                if (this.$menuDropdown) {
                    this.$menuDropdown.classList.add('hidden');
                }

                if (this.isRecording) {
                    this.stop();
                } else {
                    this.start();
                }
            });
        }
    }

    updateSessions(sessions) {
        this.sessions = sessions || [];
    }

    /**
     * 查找地图 Canvas
     */
    findMapCanvas() {
        if (!this.mapRenderer || !this.mapRenderer.map) return null;
        const container = this.mapRenderer.map.getContainer();
        // 尝试获取地图底层的 Canvas (通常是第一个 Canvas)
        const canvas = container.querySelector('canvas.amap-layer') || container.querySelector('canvas');
        return canvas;
    }

    async start() {
        if (this.isRecording) return;

        // 1. 检查地图 Canvas
        const mapCanvas = this.findMapCanvas();
        if (!mapCanvas) {
            this.onError(new Error('Cannot find Map Canvas for recording'));
            alert('无法找到地图 Canvas，录制失败。请确保地图已完全加载。');
            return;
        }

        try {
            console.log('[VideoExporter] Starting high-performance video export...');

            // 2. 创建合成 Canvas
            this.compositeCanvas = document.createElement('canvas');
            this.compositeCanvas.width = this.outputWidth;
            this.compositeCanvas.height = this.outputHeight;
            this.ctx = this.compositeCanvas.getContext('2d', { alpha: false }); // 优化性能

            // 3. 获取 Canvas 流 (尝试 60FPS)
            const stream = this.compositeCanvas.captureStream(60);

            // 4. 选择最佳 MIME 类型 (优先 MP4)
            let mimeType = 'video/webm;codecs=vp9';
            if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E,mp4a.40.2')) {
                mimeType = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';
            } else if (MediaRecorder.isTypeSupported('video/mp4')) {
                mimeType = 'video/mp4';
            }

            console.log('[VideoExporter] Using MIME type:', mimeType);

            this.recordedChunks = [];
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: mimeType,
                videoBitsPerSecond: this.bitRate,
            });

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.exportVideo(mimeType);
            };

            // 5. 设置播放速度并开始
            if (this.player) {
                this.originalSpeed = this.player.speed; // 保存原始速度
                this.player.seekTo(0);
                this.player.play();

                // 设置为 240x 倍速录制
                setTimeout(() => {
                    this.player.setSpeed(240);
                    // 更新 UI 为了直观（可选）
                    const speedSelect = document.getElementById('speed-select');
                    if (speedSelect) speedSelect.value = '240';
                }, 100);
            }

            // 6. 启动录制
            this.mediaRecorder.start();
            this.isRecording = true;

            // 更新 UI
            if (this.$btnExport) {
                this.$btnExport.classList.add('recording');
                this.$btnExport.innerHTML = '<i class="fas fa-stop"></i><span>停止导出</span>';
            }

            console.log('[VideoExporter] Recording started');
            this.onRecordingStart();

            // 7. 开始帧循环 (使用 requestAnimationFrame 实现流畅录制)
            this.lastTime = Date.now();
            this.captureLoop(mapCanvas);

        } catch (error) {
            console.error('[VideoExporter] Failed to start:', error);
            this.onError(error);
            this.resetUI();
        }
    }

    captureLoop(mapCanvas) {
        if (!this.isRecording) return;

        try {
            this.renderFrame(mapCanvas);
        } catch (err) {
            console.warn('[VideoExporter] renderFrame error:', err);
        }

        this.animationFrameId = requestAnimationFrame(() => this.captureLoop(mapCanvas));
    }

    renderFrame(mapCanvas) {
        if (!this.ctx) return;

        // 1. 绘制黑色背景
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(0, 0, this.outputWidth, this.outputHeight);

        // 2. 绘制地图 Canvas (直接从 DOM Canvas 复制，极快)
        // 计算保持比例的尺寸
        const mapAspect = mapCanvas.width / mapCanvas.height;
        const canvasAspect = this.outputWidth / this.outputHeight;
        let drawWidth, drawHeight, drawX, drawY;

        if (mapAspect > canvasAspect) {
            drawWidth = this.outputWidth;
            drawHeight = this.outputWidth / mapAspect;
            drawX = 0;
            drawY = (this.outputHeight - drawHeight) / 2;
        } else {
            drawHeight = this.outputHeight;
            drawWidth = this.outputHeight * mapAspect;
            drawX = (this.outputWidth - drawWidth) / 2;
            drawY = 0;
        }

        // 绘制地图底图
        this.ctx.drawImage(mapCanvas, 0, 0, mapCanvas.width, mapCanvas.height, drawX, drawY, drawWidth, drawHeight);

        // 3. 手动绘制 Avatar (因为 DOM 元素无法被 Canvas 捕获)
        this.drawAvatarOverlay(drawX, drawY, drawWidth, mapCanvas.width);

        // 4. 绘制图表叠加层
        if (this.chartManager) {
            this.drawChartsOverlay(drawX, drawY, drawWidth, drawHeight);
        }
    }

    drawAvatarOverlay(mapX, mapY, mapDrawWidth, mapSourceWidth) {
        if (!this.player || !this.mapRenderer || !this.mapRenderer.map) return;

        const currentSecond = this.player.currentSecond;
        const dpr = window.devicePixelRatio || 1;
        // 计算缩放比例:  目标宽度 / (源宽度) 
        // 源宽度 (mapCanvas.width) = containerWidth * dpr
        // 所以 scale = mapDrawWidth / mapCanvas.width
        const scale = mapDrawWidth / mapSourceWidth;

        this.sessions.forEach((session, index) => {
            // 找到当前位置
            const point = this.findPointAtTime(session.points, currentSecond);
            if (point) {
                // 将经纬度转换为容器像素坐标 (Container CSS Pixels)
                const pixel = this.mapRenderer.map.lngLatToContainer([point.lng, point.lat]);

                // 转换为 Canvas 坐标
                // 原始 Canvas 上的位置 = pixel * dpr
                // 绘制 Canvas 上的位置 = (pixel * dpr) * scale + offset
                const x = mapX + (pixel.x * dpr) * scale;
                const y = mapY + (pixel.y * dpr) * scale;

                // 绘制 Avatar 点
                this.ctx.beginPath();
                this.ctx.arc(x, y, 8, 0, Math.PI * 2);

                // 颜色 (使用预定义颜色或随机颜色)
                const colors = ['#ff4d4f', '#1890ff', '#52c41a', '#faad14'];
                this.ctx.fillStyle = colors[index % colors.length];
                this.ctx.fill();

                // 白色边框
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = 3;
                this.ctx.stroke();
            }
        });
    }

    // 简单的二分查找
    findPointAtTime(points, targetSecond) {
        if (!points || points.length === 0) return null;
        let left = 0;
        let right = points.length - 1;
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (points[mid].elapsed_time < targetSecond) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        return points[left];
    }

    drawChartsOverlay(mapX, mapY, mapWidth, mapHeight) {
        // ... (与之前相同，直接绘制 DOM canvas) ...
        const chartCanvases = document.querySelectorAll('.chart-box canvas');
        if (chartCanvases.length === 0) return;

        const chartHeight = 120;
        const chartY = this.outputHeight - chartHeight - 40; // 稍微抬高一点
        const chartAreaWidth = this.outputWidth - 80;

        // 半透明背景
        this.ctx.fillStyle = 'rgba(26, 26, 46, 0.8)';
        this.ctx.fillRect(40, chartY, chartAreaWidth, chartHeight + 20);

        // 绘制每个图表
        const chartSlotWidth = chartAreaWidth / chartCanvases.length;
        chartCanvases.forEach((canvas, index) => {
            const x = 40 + index * chartSlotWidth;
            try {
                // 保持图表比例
                this.ctx.drawImage(canvas, x + 10, chartY + 10, chartSlotWidth - 20, chartHeight);
            } catch (e) { }
        });
    }

    stop() {
        if (!this.isRecording) return;

        console.log('[VideoExporter] Stopping...');
        this.isRecording = false;

        // 停止动画循环
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // 停止播放并恢复原始速度
        if (this.player) {
            this.player.pause();
            const originalSpeed = this.originalSpeed || 120; // 默认恢复到 120
            this.player.setSpeed(originalSpeed);

            const speedSelect = document.getElementById('speed-select');
            if (speedSelect) speedSelect.value = originalSpeed.toString();
        }

        // 停止录制
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        this.resetUI();
        this.onRecordingStop();
    }

    async exportVideo(mimeType) {
        if (this.recordedChunks.length === 0) {
            console.warn('[VideoExporter] No data to export');
            return;
        }

        const blob = new Blob(this.recordedChunks, { type: mimeType });

        // 确定扩展名
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';

        // 生成文件名: runback-yyyy-mm-ddThh-mm-ss.mp4
        const now = new Date();
        const pad = (n) => n.toString().padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        const filename = `runback-${timestamp}.${ext}`;

        console.log('[VideoExporter] Video exported:', filename, 'Size:', (blob.size / 1024 / 1024).toFixed(2), 'MB');

        // 下载逻辑 (保持不变)
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: ext.toUpperCase() + ' Video',
                        accept: { [mimeType.split(';')[0]]: ['.' + ext] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                alert(`视频已保存!\n文件大小: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
                return;
            } catch (e) {
                if (e.name !== 'AbortError') console.warn(e);
                else return;
            }
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 1000);

        // 只有在使用 Blob URL 下载时才提示，File System API 不需要
        alert(`视频已下载: ${filename}`);
    }

    resetUI() {
        if (this.$btnExport) {
            this.$btnExport.classList.remove('recording');
            this.$btnExport.innerHTML = '<i class="fas fa-video"></i><span>导出视频</span>';
        }
    }
}

// ========================================
// App - 主应用 - 多用户支持
// ========================================
class App {
    constructor() {
        this.themeManager = new ThemeManager();
        this.fitParser = new FitParser();
        this.tcxParser = new TcxParser();
        this.gpxParser = new GpxParser();
        this.mapRenderer = new MapRenderer('map');
        this.dataPanel = new DataPanel();
        this.chartManager = new ChartManager();

        // 多用户支持：存储会话数组
        this.sessions = [];

        // 连接 ChartManager 到 DataPanel
        this.dataPanel.setChartManager(this.chartManager);

        // 立即初始化播放器（不等待地图加载）
        this.player = new Player({
            onPositionChange: (pointsArray, second) => {
                // 多用户版本：pointsArray 是各用户当前点位数组
                if (this.mapRenderer) {
                    this.mapRenderer.updateMarkerPositions(pointsArray);
                }
                if (this.dataPanel) {
                    this.dataPanel.updateMultiple(pointsArray, second);
                }
            },
            onTimeUpdate: (current, total) => {
                // 如果正在录制且播放结束，自动停止录制
                if (this.screenRecorder && this.screenRecorder.isRecording) {
                    if (current >= total && total > 0) {
                        console.log('[App] Playback finished, auto-stopping recording');
                        this.screenRecorder.stop();
                    }
                }
            },
            onPlayStateChange: (playing) => {
                // 可以添加播放状态变化逻辑
            },
        });

        // 初始化视频导出器
        this.videoExporter = new VideoExporter({
            mapRenderer: this.mapRenderer,
            chartManager: this.chartManager,
            player: this.player,
            onRecordingStart: () => {
                console.log('[App] Video export started');
            },
            onRecordingStop: () => {
                console.log('[App] Video export stopped');
            },
            onError: (err) => {
                console.error('[App] Video export error:', err);
            },
        });

        this.init();
    }

    async init() {
        // 初始化地图
        await this.mapRenderer.init();

        // 设置文件上传
        this.setupFileUpload();

        // 设置地图控制
        this.setupMapControls();

        // 设置新文件按钮 - 直接打开文件选择器
        const btnNewFile = document.getElementById('btn-new-file');
        const landingFileInput = document.getElementById('landing-file-input');

        if (btnNewFile && landingFileInput) {
            btnNewFile.addEventListener('click', () => {
                // 清空input value以允许重新选择同一文件
                landingFileInput.value = '';
                landingFileInput.click();
            });
        }
    }

    setupFileUpload() {
        const uploadOverlay = document.getElementById('upload-overlay');

        // 如果使用新的启动页，跳过旧的上传覆盖层设置
        if (!uploadOverlay) {
            console.log('Using landing page for file upload, skipping upload-overlay setup');
            return;
        }

        const uploadBox = uploadOverlay.querySelector('.upload-box');
        const fileInput = document.getElementById('file-input');
        const selectFileBtn = document.getElementById('select-file-btn');

        // 点击选择文件
        if (selectFileBtn && fileInput) {
            selectFileBtn.addEventListener('click', () => fileInput.click());
        }

        // 文件选择变化
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.loadFiles(Array.from(e.target.files));
                }
            });
        }

        // 拖拽上传
        if (uploadOverlay && uploadBox) {
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

                const files = Array.from(e.dataTransfer.files);
                this.loadFiles(files);
            });
        }
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

    /**
     * 加载多个文件（新的多用户入口）
     * @param {Array<File>} files - 文件列表
     */
    async loadFiles(files) {
        // 验证文件数量
        if (files.length > MAX_FILES) {
            alert(`最多支持同时加载 ${MAX_FILES} 个文件，您选择了 ${files.length} 个文件。请减少选择的文件数量。`);
            return;
        }

        if (files.length === 0) {
            return;
        }

        try {
            console.log(`Loading ${files.length} file(s)...`);

            // 重置旧数据
            if (this.dataPanel) {
                this.dataPanel.reset();
            }
            if (this.chartManager) {
                this.chartManager.destroy();
            }
            if (this.player) {
                this.player.pause();
            }

            // 清空会话
            this.sessions = [];

            // 解析所有文件
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                console.log(`Parsing file ${i + 1}/${files.length}: ${file.name}`);

                try {
                    const arrayBuffer = await file.arrayBuffer();

                    // 根据文件扩展名选择解析器
                    const ext = file.name.split('.').pop().toLowerCase();
                    let parsedData;

                    if (ext === 'tcx') {
                        parsedData = await this.tcxParser.parse(arrayBuffer);
                    } else if (ext === 'gpx') {
                        parsedData = await this.gpxParser.parse(arrayBuffer);
                    } else if (ext === 'fit') {
                        parsedData = await this.fitParser.parse(arrayBuffer);
                    } else {
                        throw new Error(`不支持的文件格式: .${ext}`);
                    }

                    if (parsedData.points.length === 0) {
                        console.warn(`File ${file.name} has no GPS data, skipping.`);
                        continue;
                    }

                    this.sessions.push({
                        fileName: file.name,
                        points: parsedData.points,
                        indexedPoints: parsedData.indexedPoints,
                        totalSeconds: parsedData.totalSeconds,
                        startTime: parsedData.startTime,
                        endTime: parsedData.endTime,
                    });
                } catch (parseError) {
                    console.error(`Error parsing file ${file.name}:`, parseError);
                    // 继续处理其他文件
                }
            }

            if (this.sessions.length === 0) {
                alert('没有找到有效的 GPS 数据');
                return;
            }

            console.log(`Successfully loaded ${this.sessions.length} session(s)`);

            // 计算全局最大时长
            const globalTotalSeconds = Math.max(...this.sessions.map(s => s.totalSeconds));

            // 绘制所有轨迹
            if (this.mapRenderer) {
                this.mapRenderer.drawTracks(this.sessions);
            }

            // 初始化多用户图表
            if (this.chartManager) {
                this.chartManager.initMultiCharts(this.sessions, globalTotalSeconds);
            }

            // 更新视频导出器的会话数据
            if (this.videoExporter) {
                this.videoExporter.updateSessions(this.sessions);
            }

            // 初始化数据面板
            if (this.dataPanel) {
                this.dataPanel.initSummaries(this.sessions);
            }

            // 设置播放器数据
            if (this.player) {
                const playerSessions = this.sessions.map(s => ({
                    indexedPoints: s.indexedPoints,
                    totalSeconds: s.totalSeconds,
                    fileName: s.fileName,
                }));
                this.player.setSessionsData(playerSessions, globalTotalSeconds);
            }

            // initSummaries 已显示总数据，播放时再更新
            // （移除初始 updateMultiple 调用，避免覆盖总数据）

            // 隐藏上传覆盖层，显示控制面板
            this.hideUploadOverlay();
            this.showControls();

        } catch (error) {
            console.error('Error loading files:', error);
            alert('加载文件失败: ' + error.message);
        }
    }

    /**
     * 向后兼容：单文件加载
     */
    async loadFile(file) {
        await this.loadFiles([file]);
    }

    hideUploadOverlay() {
        // 隐藏启动页（如果存在）
        const landingPage = document.getElementById('landing-page');
        if (landingPage) {
            landingPage.classList.add('hidden');
        }

        // 隐藏旧的上传覆盖层（如果存在）
        const uploadOverlay = document.getElementById('upload-overlay');
        if (uploadOverlay) {
            uploadOverlay.classList.add('hidden');
        }
    }

    showUploadOverlay() {
        // 显示启动页（如果存在）
        const landingPage = document.getElementById('landing-page');
        if (landingPage) {
            landingPage.classList.remove('hidden');
        }

        // 显示旧的上传覆盖层（如果存在）
        const uploadOverlay = document.getElementById('upload-overlay');
        if (uploadOverlay) {
            uploadOverlay.classList.remove('hidden');
        }

        // 隐藏控制面板
        const playerControls = document.getElementById('player-controls');
        if (playerControls) {
            playerControls.classList.add('hidden');
        }

        const dataPanel = document.getElementById('data-panel');
        if (dataPanel) {
            dataPanel.classList.add('hidden');
        }
    }

    showControls() {
        const playerControls = document.getElementById('player-controls');
        if (playerControls) {
            playerControls.classList.remove('hidden');
        }

        const dataPanel = document.getElementById('data-panel');
        if (dataPanel) {
            dataPanel.classList.remove('hidden');
        }
    }
}

// ========================================
// Initialize App
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    // ========== Landing Page Initialization ==========
    const landingPage = document.getElementById('landing-page');
    const landingFileInput = document.getElementById('landing-file-input');
    const landingUploadBtn = document.getElementById('landing-upload-btn');

    // File upload button click
    if (landingUploadBtn) {
        landingUploadBtn.addEventListener('click', () => {
            // 清空value以允许重选同一文件
            landingFileInput.value = '';
            landingFileInput.click();
        });
    }

    // File selection (multiple files supported)
    if (landingFileInput) {
        landingFileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            if (files.length > 0) {
                handleFilesUpload(files);
            }
        });
    }

    // Drag and drop support (multiple files)
    if (landingPage) {
        landingPage.addEventListener('dragover', (e) => {
            e.preventDefault();
            landingPage.style.opacity = '0.8';
        });

        landingPage.addEventListener('dragleave', () => {
            landingPage.style.opacity = '1';
        });

        landingPage.addEventListener('drop', (e) => {
            e.preventDefault();
            landingPage.style.opacity = '1';

            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) {
                handleFilesUpload(files);
            }
        });
    }

    // Handle multiple file upload
    function handleFilesUpload(files) {
        // Validate file count
        if (files.length > MAX_FILES) {
            alert(`最多支持同时加载 ${MAX_FILES} 个文件，您选择了 ${files.length} 个文件。请减少选择的文件数量。`);
            return;
        }

        // Hide landing page
        if (landingPage) {
            landingPage.classList.add('hidden');
        }

        // Process files using App instance
        if (window.app && window.app.loadFiles) {
            window.app.loadFiles(files);
        } else {
            console.error('App not initialized');
        }
    }

    // ========== Existing Initialization ==========
    window.app = new App();
});

/**
 * Unit tests for Runback core logic
 */

import { describe, it, expect } from 'vitest';

// Note: We need to extract CoordTransform and related functions from app.js
// For now, we'll create isolated tests based on the expected behavior

describe('CoordTransform', () => {
    // The actual CoordTransform object is defined in app.js
    // These tests verify the expected transformation behavior

    const CoordTransform = {
        PI: Math.PI,
        A: 6378245.0,
        EE: 0.00669342162296594323,

        outOfChina(lng, lat) {
            return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
        },

        transformLat(lng, lat) {
            let ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat +
                0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
            ret += (20.0 * Math.sin(6.0 * lng * this.PI) + 20.0 * Math.sin(2.0 * lng * this.PI)) * 2.0 / 3.0;
            ret += (20.0 * Math.sin(lat * this.PI) + 40.0 * Math.sin(lat / 3.0 * this.PI)) * 2.0 / 3.0;
            ret += (160.0 * Math.sin(lat / 12.0 * this.PI) + 320 * Math.sin(lat * this.PI / 30.0)) * 2.0 / 3.0;
            return ret;
        },

        transformLng(lng, lat) {
            let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng +
                0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
            ret += (20.0 * Math.sin(6.0 * lng * this.PI) + 20.0 * Math.sin(2.0 * lng * this.PI)) * 2.0 / 3.0;
            ret += (20.0 * Math.sin(lng * this.PI) + 40.0 * Math.sin(lng / 3.0 * this.PI)) * 2.0 / 3.0;
            ret += (150.0 * Math.sin(lng / 12.0 * this.PI) + 300.0 * Math.sin(lng / 30.0 * this.PI)) * 2.0 / 3.0;
            return ret;
        },

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

    it('should return original coords for points outside China', () => {
        const result = CoordTransform.wgs84ToGcj02(-122.4194, 37.7749); // San Francisco
        expect(result.lng).toBe(-122.4194);
        expect(result.lat).toBe(37.7749);
    });

    it('should transform coords for points inside China', () => {
        const result = CoordTransform.wgs84ToGcj02(118.79, 32.06); // Nanjing
        expect(result.lng).not.toBe(118.79);
        expect(result.lat).not.toBe(32.06);
        // The transformation should be small but noticeable
        expect(Math.abs(result.lng - 118.79)).toBeLessThan(0.01);
        expect(Math.abs(result.lat - 32.06)).toBeLessThan(0.01);
    });

    it('should correctly identify China boundaries', () => {
        expect(CoordTransform.outOfChina(118.79, 32.06)).toBe(false); // Nanjing - inside
        expect(CoordTransform.outOfChina(-122.4, 37.7)).toBe(true);   // SF - outside
        expect(CoordTransform.outOfChina(139.7, 35.7)).toBe(true);    // Tokyo - outside
    });
});

describe('USER_STYLES Configuration', () => {
    const MAX_FILES = 4;
    const USER_STYLES = [
        { color: '#3b82f6', label: '用户 1', avatarBg: '#2563eb', textColor: '#ffffff' },
        { color: '#ef4444', label: '用户 2', avatarBg: '#dc2626', textColor: '#ffffff' },
        { color: '#10b981', label: '用户 3', avatarBg: '#059669', textColor: '#ffffff' },
        { color: '#f59e0b', label: '用户 4', avatarBg: '#d97706', textColor: '#ffffff' }
    ];

    it('should have exactly MAX_FILES (4) user styles', () => {
        expect(USER_STYLES.length).toBe(MAX_FILES);
    });

    it('should have unique colors for each user', () => {
        const colors = USER_STYLES.map(s => s.color);
        const uniqueColors = new Set(colors);
        expect(uniqueColors.size).toBe(MAX_FILES);
    });

    it('each style should have required properties', () => {
        USER_STYLES.forEach(style => {
            expect(style).toHaveProperty('color');
            expect(style).toHaveProperty('label');
            expect(style).toHaveProperty('avatarBg');
            expect(style).toHaveProperty('textColor');
        });
    });
});

describe('generateAvatarIcon', () => {
    const USER_STYLES = [
        { color: '#3b82f6', label: '用户 1', avatarBg: '#2563eb', textColor: '#ffffff' }
    ];

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

    it('should generate a valid data URL', () => {
        const icon = generateAvatarIcon(0);
        expect(icon.startsWith('data:image/svg+xml,')).toBe(true);
    });

    it('should include user index + 1 as label', () => {
        const icon = generateAvatarIcon(0);
        const decoded = decodeURIComponent(icon.replace('data:image/svg+xml,', ''));
        expect(decoded).toContain('>1<');
    });

    it('should use specified size', () => {
        const icon = generateAvatarIcon(0, 48);
        const decoded = decodeURIComponent(icon.replace('data:image/svg+xml,', ''));
        expect(decoded).toContain('width="48"');
        expect(decoded).toContain('height="48"');
    });
});

describe('Session Data Structure', () => {
    it('should correctly calculate globalTotalSeconds', () => {
        const sessions = [
            { totalSeconds: 1800 },  // 30 min
            { totalSeconds: 3600 },  // 60 min
            { totalSeconds: 2400 }   // 40 min
        ];

        const globalTotalSeconds = Math.max(...sessions.map(s => s.totalSeconds));
        expect(globalTotalSeconds).toBe(3600);
    });

    it('should handle single session', () => {
        const sessions = [{ totalSeconds: 1800 }];
        const globalTotalSeconds = Math.max(...sessions.map(s => s.totalSeconds));
        expect(globalTotalSeconds).toBe(1800);
    });
});

describe('Time Formatting', () => {
    function formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    it('should format 0 seconds correctly', () => {
        expect(formatTime(0)).toBe('00:00:00');
    });

    it('should format minutes correctly', () => {
        expect(formatTime(65)).toBe('00:01:05');
    });

    it('should format hours correctly', () => {
        expect(formatTime(3661)).toBe('01:01:01');
    });

    it('should format large durations', () => {
        expect(formatTime(7200)).toBe('02:00:00');
    });
});

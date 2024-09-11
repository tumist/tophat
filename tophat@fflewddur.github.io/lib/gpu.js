'use strict';

// Copyright (C) 2020 Todd Kulesza <todd@dropline.net>

// This file is part of TopHat.

// TopHat is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// TopHat is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with TopHat. If not, see <https://www.gnu.org/licenses/>.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Config from './config.js';
import * as Shared from './shared.js';
import * as Monitor from './monitor.js';
import * as FileModule from './file.js';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

export const GpuMonitor = GObject.registerClass(
    class GpuMonitor extends Monitor.TopHatMonitor {
        _init(configHandler) {
            super._init('Tophat GPU Monitor');

            let gicon = Gio.icon_new_for_string(`${configHandler.metadata.path}/icons/gpu-icon-symbolic.svg`);
            this.icon = new St.Icon({gicon, style_class: 'system-status-icon tophat-panel-icon'});
            this.add_child(this.icon);

            this.usage = new St.Label({
                text: '',
                style_class: 'tophat-panel-usage',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this.usage);

            configHandler.settings.bind('show-gpu', this, 'visible', Gio.SettingsBindFlags.GET);
            configHandler.settings.bind('meter-fg-color', this, 'meter-fg-color', Gio.SettingsBindFlags.GET);
            configHandler.settings.bind('meter-bar-width', this, 'meter-bar-width', Gio.SettingsBindFlags.GET);
            configHandler.settings.bind('show-animations', this, 'show-animation', Gio.SettingsBindFlags.GET);

            this.history = new Array(0);
            this.refreshTimer = 0;

            let id = this.connect('notify::visible', () => {
                if (this.visible) {
                    this._startTimers();
                } else {
                    this._stopTimers();
                }
            });
            this._signals.push(id);

            this._buildMeter();
            this._buildMenu();
            this._startTimers();
        }

        _buildMeter() {
            this.setMeter(new Monitor.Meter(2, this.meter_bar_width));
        }

        _buildMenu() {
            let label = new St.Label({text: _('GPU usage'), style_class: 'menu-header'});
            this.addMenuRow(label, 0, 2, 1);

            label = new St.Label({text: _('GPU utilization:'), style_class: 'menu-label menu-section-end'});
            this.addMenuRow(label, 0, 1, 1);
            this.menuGpuUsage = new St.Label({text: '0%', style_class: 'menu-value menu-section-end'});
            this.addMenuRow(this.menuGpuUsage, 1, 1, 1);

            label = new St.Label({text: _('GPU memory use:'), style_class: 'menu-label menu-section-end'});
            this.addMenuRow(label, 0, 1, 1);
            this.menuGpuMemUsage = new St.Label({text: '0%', style_class: 'menu-value menu-section-end'});
            this.addMenuRow(this.menuGpuMemUsage, 1, 1, 1);

            this.historyChart = new St.DrawingArea({style_class: 'chart'});
            this.historyChart.connect('repaint', () => this._repaintHistory());
            this.addMenuRow(this.historyChart, 0, 2, 1);

            this.buildMenuButtons();
        }

        _startTimers() {
            // Clear the history chart
            this.history = [];
    
            if (this.refreshTimer === 0) {
                this.refreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Config.UPDATE_INTERVAL_CPU, () => this._refreshCharts());
            }
        }

        _stopTimers() {
            if (this.refreshTimer !== 0) {
                GLib.source_remove(this.refreshTimer);
                this.refreshTimer = 0;
            }
        }

        refresh() {
            this._refreshCharts();
        }

        _refreshCharts() {
            let currentGpuUsage = 0;
            let currentGpuMemUsage = 0;
            currentGpuUsage = parseInt(
                new FileModule.File('/sys/class/drm/card1/device/gpu_busy_percent').readSync()
            );
            currentGpuMemUsage = parseInt(
                new FileModule.File('/sys/class/drm/card1/device/mem_busy_percent').readSync()
            );

            this.meter.setUsage([currentGpuUsage, currentGpuMemUsage]);
            this.usage.text = `${currentGpuUsage}%`;
            this.menuGpuUsage.text = `${currentGpuUsage}%`;
            this.menuGpuMemUsage.text = `${currentGpuMemUsage}%`;

            while (this.history.length >= Config.HISTORY_MAX_SIZE) {
                this.history.shift();
            }
            this.history.push(currentGpuUsage);

            this.historyChart.queue_repaint();

            return true;
        }

        _repaintHistory() {
            let [width, height] = this.historyChart.get_surface_size();
            let pointSpacing = width / (Config.HISTORY_MAX_SIZE - 1);
            let xStart = (Config.HISTORY_MAX_SIZE - this.history.length) * pointSpacing;
            let ctx = this.historyChart.get_context();
            var fg, bg;
            [, fg] = Clutter.Color.from_string(this.meter_fg_color);
            [, bg] = Clutter.Color.from_string(Config.METER_BG_COLOR);
    
            Shared.setSourceColor(ctx, bg);
            ctx.rectangle(0, 0, width, height);
            ctx.fill();
    
            Shared.setSourceColor(ctx, fg);
            ctx.moveTo(xStart, height);
            for (let i = 0; i < this.history.length; i++) {
                let pointHeight = Math.ceil(this.history[i] * height / 100);
                let x = xStart + pointSpacing * i;
                let y = height - pointHeight;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(xStart + (this.history.length - 1) * pointSpacing, height);
            ctx.closePath();
            ctx.fill();
    
            ctx.$dispose();
        }

        destroy() {
            this._stopTimers();
            super.destroy();
        }
    }
);
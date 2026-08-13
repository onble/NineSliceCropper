# NineSliceCropper

一个完全在浏览器本地运行的九宫格 PNG 裁剪工具。它会删除可拉伸的中间区域，将四个角重新拼接成更小的 PNG，并完整保留透明通道。

## 本地运行

```bash
npm install
npm run dev


本地局域网服务
npm run dev -- --host 0.0.0.0
```

构建与测试：

```bash
npm test
npm run build
```

## 像素坐标模型

`left` 和 `top` 分别是从源图左侧、顶部开始计算的切片坐标。`right` 和 `bottom` 是右侧切片线的 X 坐标与下侧切片线的 Y 坐标，不是边距值。所有边界均为整数像素，并满足：

```text
0 < left <= right < imageWidth
0 < top <= bottom < imageHeight
```

导出时通过四次源区域与目标区域尺寸完全相同的 `drawImage` 调用完成拼接，因此不会缩放或插值四角像素。小于 2 × 2 像素的图片可以预览，但无法形成四个非空角区域，因此不能导出。

## 无损 PNG 优化

导出时会在独立 Web Worker 中使用 OxiPNG WASM 自动优化浏览器生成的基础 PNG：

- 固定使用无损优化，不缩放、不量化颜色。
- 禁用透明像素 RGB 改写（`optimiseAlpha: false`）。
- 只有优化结果尺寸严格更小时才采用；相等或更大时保留基础 PNG。
- Worker 异常、浏览器不支持或 30 秒超时时，仍会正常导出基础 PNG。
- 界面会显示优化前后的文件体积与缩减比例。

使用的 `@jsquash/oxipng` 采用 Apache-2.0 许可证，底层 OxiPNG 采用 MIT 许可证。

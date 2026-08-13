# NineSliceCropper

一个完全在浏览器本地运行的九宫格 PNG 裁剪工具。它会删除可拉伸的中间区域，将四个角重新拼接成更小的 PNG，并完整保留透明通道。

## 本地运行

```bash
npm install
npm run dev
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

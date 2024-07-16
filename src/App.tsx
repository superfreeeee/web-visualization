import { memo, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import * as d3 from 'd3';

import styles from './App.module.scss';

enum FileType {
  Unknown = '',
  Dir = 'dir',
  Js = 'js',
}

interface FileData {
  // ref info
  parent?: FileData;
  children: FileData[];

  // cur node info
  type: FileType;
  path: string;
  base: string;
  level: number; // col number
  seq: number; // row number
  x: number;
  y: number;
}

const getMeasureSvg = () => {
  const svg = d3.select(document.body).select('svg.measure');
  if (!svg.empty()) {
    return svg;
  }

  return d3 //
    .select(document.body)
    .append('svg')
    .attr('class', 'measure')
    .attr('visibility', 'hidden');
};

const getMeasureTextNode = (): d3.Selection<SVGTextElement, unknown, null, undefined> => {
  const svg = getMeasureSvg();
  const text = svg.select<SVGTextElement>('&>text');
  if (!text.empty()) {
    return text;
  }
  return svg.append('text');
};

const measureTextWidth = (content: string) => {
  const text = getMeasureTextNode();
  const width = text.text(content).node()!.getBBox().width;
  return width;
};

const createFileDatas = (filePaths: string[]) => {
  const filesMap = new Map<string, FileData>();

  filePaths.forEach((filePath) => {
    const paths = filePath.split('/');
    const n = paths.length;

    /**
     * 生成节点
     * set type, path, base, level
     */
    const files = paths.map((base, index) => {
      const path = paths.slice(0, index + 1).join('/');
      const type = index === n - 1 ? FileType.Js : FileType.Dir;

      const data: FileData = filesMap.get(path) ?? {
        children: [],
        path,
        type,
        base,
        level: index,
        seq: 0,
        x: 0,
        y: 0,
      };

      if (!filesMap.has(path)) {
        filesMap.set(path, data);
      }

      return data;
    });

    // set parent, children
    for (let i = 1; i < n; i++) {
      files[i].parent = files[i - 1];
      if (!files[i - 1].children.includes(files[i])) {
        files[i - 1].children.push(files[i]);
      }
    }
  });

  let rootSeq = 0;

  // set seq
  [...filesMap.values()].forEach((fileData) => {
    if (fileData.level === 0) {
      fileData.seq = rootSeq++;
    }

    fileData.children
      .toSorted((a, b) => {
        if (a.type !== b.type) {
          if (a.type === FileType.Dir) {
            return -1;
          }
          if (b.type === FileType.Dir) {
            return 1;
          }
        }

        return a.base < b.base ? -1 : 1;
      })
      .forEach((child, index) => {
        child.seq = index;
      });
  });

  // calc levelOffset
  const levelOffset: number[] = [];
  [...filesMap.values()]
    .toSorted((a, b) => {
      if (a.level !== b.level) {
        return a.level - b.level;
      }
      return b.children.length - a.children.length;
    })
    .forEach((file) => {
      if (!levelOffset[file.level] || file.children.length > 0) {
        levelOffset[file.level] = Math.max(levelOffset[file.level] || 0, measureTextWidth(file.base) + 40);
      }
    });
  levelOffset.pop(); // 忽略最后一个 level 的宽度
  for (let i = 1; i < levelOffset.length; i++) {
    levelOffset[i] = levelOffset[i - 1] + levelOffset[i];
  }
  for (let i = 0; i < levelOffset.length; i++) {
    levelOffset[i] = levelOffset[i] + (i + 1) * 60; // gap 60
  }
  levelOffset.unshift(0);

  const setFilePos = (fileData: FileData, baseY: number) => {
    fileData.x = levelOffset[fileData.level];
    fileData.y = baseY + Math.min(1, fileData.seq) * (32 + 16);

    let lastChild = fileData;
    fileData.children
      .toSorted((a, b) => a.seq - b.seq)
      .forEach((child) => {
        lastChild = setFilePos(child, lastChild.y);
      });

    return lastChild;
  };

  let lastChild: FileData | undefined;
  // set x, y
  for (const rootFile of [...filesMap.values()].filter((file) => file.level === 0).toSorted((a, b) => a.seq - b.seq)) {
    const nextLastChild = setFilePos(rootFile, lastChild ? lastChild.y : 0);
    lastChild = nextLastChild;
  }

  return {
    files: [...filesMap.values()],
    levelOffset,
  };
};

const File = memo((props: { data: FileData }) => {
  const { data } = props;
  const type = data.type ?? FileType.Unknown;

  const groupRef = useRef<SVGGElement>(null);

  const selectGroup = () => d3.select(groupRef.current!);
  const selectRect = () => selectGroup().select<SVGRectElement>('rect');
  const selectText = () => selectGroup().select<SVGTextElement>('text');

  const isRenderedRef = useRef(false);
  useEffect(() => {
    if (isRenderedRef.current) {
      return;
    }

    const { x, y, base, type, children } = data;

    const group = selectGroup();
    group.datum(data);
    group
      .append('rect')
      .attr('class', classNames(styles.FileRect, styles[type]))
      .attr('x', x)
      .attr('y', y)
      .attr('width', measureTextWidth(base))
      .attr('height', 32)
      .attr('rx', 8);

    group
      .append('text')
      .attr('x', x + 20)
      .attr('y', y + 16)
      .attr('dominant-baseline', 'central')
      .text(base);

    if (children.length > 0) {
      const x0 = x + measureTextWidth(base) + 40 + 5;
      const y0 = y + 16;

      const x1 = children[0].x - 5;
      const y1 = Math.max(...children.map((child) => child.y)) + 16;

      const mid = (x0 + x1) / 2;

      const path = d3.path();
      path.moveTo(x0, y0);
      path.lineTo(mid, y0);
      path.lineTo(mid, y1);

      for (const child of children) {
        path.moveTo(mid, child.y + 16);
        path.lineTo(x1, child.y + 16);
      }

      d3.select('g#root').append('path').attr('d', path.toString()).attr('stroke', '#000').attr('fill', 'none');
    }
    // if (parent) {
    //   const path = d3.path();

    //   const startX = x - 2;
    //   const startY = y + 16;
    //   const endX = parent.x + measureTextWidth(parent.base) + 40 + 2;
    //   const endY = parent.y + 16;
    //   path.moveTo(startX, startY);
    //   path.lineTo((startX + endX) / 2, startY);
    //   path.lineTo((startX + endX) / 2, endY);
    //   path.lineTo(endX, endY);

    // }

    group.on('click', (_e, data) => {
      console.log(data);
    });

    isRenderedRef.current = true;
  }, []);

  // base 变化 => rect 宽度自适应
  useEffect(() => {
    const textNode = selectText().node();
    if (!textNode) {
      return;
    }

    const textBox = textNode.getBBox();
    selectRect().attr('width', textBox.width + 40);
  }, [data.base]);

  // 坐标定位
  useEffect(() => {
    // 重渲染
    selectRect() //
      .transition()
      .duration(500)
      .attr('x', data.x)
      .attr('y', data.y);

    selectText()
      .transition()
      .duration(500)
      .attr('x', data.x + 20)
      .attr('y', data.y + 16);
  }, [data.x, data.y]);

  return (
    <g ref={groupRef} className={classNames(styles.FileGroup, styles[type])}>
      {/* <rect className={classNames(styles.FileRect, styles[type])} width={80} height={32} rx={8} /> */}
      {/* <text dominantBaseline="central">{base}</text> */}
    </g>
  );
});

export function App() {
  const [files, setFiles] = useState<FileData[]>([]);
  const [levelOffset, setLevelOffset] = useState<number[]>([]);
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) {
      return;
    }
    const svg = d3.select(svgRef.current);
    const root = svg.select('g#root');
    svg.call(
      d3.zoom<SVGSVGElement, any>().on('zoom', (e) => {
        root.attr('transform', e.transform);
      }),
    );
  }, []);

  useEffect(() => {
    const { files, levelOffset } = createFileDatas([
      'src/App.tsx',
      'src/api/helpers/constants.ts',
      'src/api/helpers/index.ts',
      'src/api/helpers/response.ts',
      'src/api/ping.ts',
      'src/api/user.ts',
      'src/common/clipboard.ts',
      'src/common/env.ts',
      'src/common/lazy.tsx',
      'src/common/localStorage/base.ts',
      'src/common/localStorage/user.ts',
      'src/common/math.ts',
      'src/components/Button/index.tsx',
      'src/components/Devtools/index.tsx',
      'src/components/Icon/index.tsx',
      'src/main.tsx',
      'src/pages/breakout-game-phaser/index.tsx',
      'src/pages/breakout-game-phaser/lazy.ts',
      'src/pages/breakout-game/index.tsx',
      'src/pages/breakout-game/lazy.ts',
      'src/pages/main/components/Header/index.tsx',
      'src/pages/main/components/Header/tabs.ts',
      'src/pages/main/components/Main/index.tsx',
      'src/pages/main/index.tsx',
      'src/pages/main/pages/home/index.tsx',
      'src/pages/main/pages/poker-tools/components/PokerCardSelector/PokerCardSelector.tsx',
      'src/pages/main/pages/poker-tools/components/PokerCardText/index.tsx',
      'src/pages/main/pages/poker-tools/helpers/models.ts',
      'src/pages/main/pages/poker-tools/index.tsx',
      'src/pages/main/pages/tools/helpers/hashGenerator.ts',
      'src/pages/main/pages/tools/helpers/randomNumGenerator.ts',
      'src/pages/main/pages/tools/index.tsx',
      'src/pages/main/pages/tools/lazy.ts',
      'src/pages/mouse-track/index.tsx',
      'src/pages/mouse-track/lazy.ts',
      'src/router/constants.ts',
      'src/router/index.tsx',
      'src/router/utils.ts',
      'src/services/ping.ts',
      'src/services/user.ts',
      'src/store/user.ts',
    ]);

    let x = 0;
    let y = 0;
    files.forEach((file) => {
      x = Math.max(x, file.x);
      y = Math.max(y, file.y);
    });

    setLayout({ width: x, height: y });
    console.log({ width: x, height: y });
    setFiles(files);
    setLevelOffset(levelOffset);
  }, []);

  return (
    <div className={styles.AppContainer}>
      <div ref={containerRef} className={styles.container}>
        <svg
          ref={svgRef}
          width={'100%'}
          height={'100%'}
          viewBox={`-20 -20 ${layout.width + 100} ${layout.height + 100}`}
        >
          <g id="root">
            {files.map((file) => {
              return <File key={file.path} data={file} />;
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

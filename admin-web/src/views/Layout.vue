<template>
  <el-container style="min-height: 100vh" data-testid="layout-shell">
    <el-aside width="200px" style="background: #304156">
      <div style="padding: 20px; color: #fff; font-size: 18px; font-weight: bold;">HappyHome 管理</div>
      <el-menu data-testid="layout-menu" router background-color="#304156" text-color="#bfcbd9" active-text-color="#409EFF">
        <el-menu-item data-testid="menu-approval" index="/approval">社区审批</el-menu-item>
        <el-menu-item data-testid="menu-communities" index="/communities">社区管理</el-menu-item>
        <el-menu-item data-testid="menu-disabled-communities" index="/disabled-communities">已禁用社区</el-menu-item>
      </el-menu>
    </el-aside>
    <el-main data-testid="layout-main">
      <router-view />
    </el-main>
  </el-container>
</template>

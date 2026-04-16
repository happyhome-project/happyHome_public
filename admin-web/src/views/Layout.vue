<template>
  <el-container style="min-height: 100vh">
    <el-aside width="200px" style="background: #304156">
      <div style="padding: 20px; color: #fff; font-size: 18px; font-weight: bold;">HappyHome 管理</div>
      <el-menu router background-color="#304156" text-color="#bfcbd9" active-text-color="#409EFF">
        <el-menu-item index="/approval">社区审批</el-menu-item>
        <el-menu-item index="/communities">社区管理</el-menu-item>
        <el-menu-item index="/disabled-communities">已禁用社区</el-menu-item>
      </el-menu>
    </el-aside>
    <el-main>
      <router-view />
    </el-main>
  </el-container>
</template>
